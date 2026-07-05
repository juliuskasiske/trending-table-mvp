"""Billing routes: SetupIntent, spending limit, and the platform-fee
subscription (monthly | annual) with a Stripe webhook for status sync."""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import deps
from ... import config
from ...billing import stripe_client
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

log = logging.getLogger("billing")

router = APIRouter(prefix="/api/restaurants", tags=["billing"])
webhook_router = APIRouter(prefix="/api/stripe", tags=["billing"])


class BillingIn(BaseModel):
    spending_limit_eur: float | None = None


class SubscribeIn(BaseModel):
    cadence: str = "monthly"  # "monthly" | "annual"


def _ensure_customer(conn, rid: int, email: str | None) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT name, stripe_customer_id FROM restaurants WHERE id = %s", (rid,))
        name, customer_id = cur.fetchone()
    if not customer_id:
        customer_id = stripe_client.create_customer(email, name)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE restaurants SET stripe_customer_id = %s WHERE id = %s",
                (customer_id, rid),
            )
        conn.commit()
    return customer_id


@router.post("/{restaurant_id}/billing/subscribe")
def subscribe(body: SubscribeIn,
              ctx: dict = Depends(restaurant_ctx),
              principal: dict = Depends(deps.require_account)) -> dict:
    """Create the €50 platform-fee subscription (monthly | annual) as an
    *incomplete* subscription and hand back the PaymentIntent client secret for
    the frontend to confirm. No money moves until the card is confirmed."""
    if not stripe_client.configured():
        raise HTTPException(status_code=501, detail="Stripe is not configured.")
    cadence = "annual" if body.cadence == "annual" else "monthly"
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT stripe_subscription_status FROM restaurants WHERE id = %s", (rid,)
            )
            row = cur.fetchone()
        if row and row[0] in ("active", "trialing"):
            raise HTTPException(status_code=409, detail="Subscription already active.")
        customer_id = _ensure_customer(conn, rid, principal["email"])
        result = stripe_client.create_subscription(customer_id, cadence)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE restaurants SET stripe_subscription_id = %s, "
                "stripe_subscription_status = %s WHERE id = %s",
                (result["subscription_id"], result["status"], rid),
            )
        conn.commit()
    return {
        "clientSecret": result["client_secret"],
        "publishableKey": stripe_client.publishable_key(),
        "subscriptionId": result["subscription_id"],
        "status": result["status"],
        "mode": result["mode"],
    }


@router.post("/{restaurant_id}/billing/setup-intent")
def setup_intent(ctx: dict = Depends(restaurant_ctx),
                 principal: dict = Depends(deps.require_account)) -> dict:
    if not stripe_client.enabled():
        raise HTTPException(status_code=501, detail="Set STRIPE_SECRET_KEY.")
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, stripe_customer_id FROM restaurants WHERE id = %s", (rid,))
            name, customer_id = cur.fetchone()
        if not customer_id:
            customer_id = stripe_client.create_customer(principal["email"], name)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE restaurants SET stripe_customer_id = %s WHERE id = %s",
                    (customer_id, rid),
                )
            conn.commit()
    client_secret = stripe_client.create_setup_intent(customer_id)
    return {"clientSecret": client_secret, "publishableKey": stripe_client.publishable_key()}


@webhook_router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Keep restaurants.stripe_subscription_status in sync with Stripe.
    Verified with STRIPE_WEBHOOK_SECRET; unverified/replayed calls are rejected."""
    if not config.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=501, detail="Webhook not configured.")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe_client.construct_event(payload, sig)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature.")

    obj = event["data"]["object"]
    sub_id = None
    status = None
    etype = event["type"]
    if etype.startswith("customer.subscription."):
        sub_id, status = obj.get("id"), obj.get("status")
    elif etype in ("invoice.paid", "invoice.payment_failed"):
        sub_id = obj.get("subscription")
        status = "active" if etype == "invoice.paid" else "past_due"

    if sub_id and status:
        with get_control_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE restaurants SET stripe_subscription_status = %s "
                "WHERE stripe_subscription_id = %s",
                (status, sub_id),
            )
            conn.commit()
    return {"received": True}


@router.put("/{restaurant_id}/billing")
def set_billing(body: BillingIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Store the monthly spending limit (Stripe subscription wired in Phase 6)."""
    rid = ctx["restaurant_id"]
    limit = Decimal(str(body.spending_limit_eur)) if body.spending_limit_eur is not None else None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE restaurants SET spending_limit_eur = %s WHERE id = %s", (limit, rid))
        conn.commit()
    return {"ok": True, "spending_limit_eur": body.spending_limit_eur}
