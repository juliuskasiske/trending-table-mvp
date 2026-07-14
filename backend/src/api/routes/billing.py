"""Billing routes: SetupIntent, spending limit, and the platform-fee
subscription (monthly | annual) with a Stripe webhook for status sync."""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ... import config
from ...billing import stripe_client
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

log = logging.getLogger("billing")

router = APIRouter(prefix="/api/restaurants", tags=["billing"])
webhook_router = APIRouter(prefix="/api/stripe", tags=["billing"])
# Account-level card-on-file (collected during onboarding). Payment method lives
# on the account's Stripe customer; each locale's subscription reuses it.
account_router = APIRouter(prefix="/api/account/billing", tags=["billing"])
# Bookable restaurant/locale services (Visibility Boost, Nutzungsrechte).
account_services_router = APIRouter(prefix="/api/account", tags=["services"])


def _ensure_account_customer(conn, principal: dict) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT stripe_customer_id, display_name FROM accounts WHERE id = %s", (principal["id"],))
        customer_id, name = cur.fetchone()
    if not customer_id:
        customer_id = stripe_client.create_customer(principal["email"], name or principal["email"])
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE accounts SET stripe_customer_id = %s WHERE id = %s",
                (customer_id, principal["id"]),
            )
        conn.commit()
    return customer_id


@account_router.get("")
def account_billing(principal: dict = Depends(deps.require_account)) -> dict:
    """Whether Stripe is live and whether the account already has a card on file."""
    if not stripe_client.configured():
        return {"stripeEnabled": False, "hasCard": False, "publishableKey": None}
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT stripe_customer_id FROM accounts WHERE id = %s", (principal["id"],))
        (customer_id,) = cur.fetchone()
    return {
        "stripeEnabled": True,
        "hasCard": stripe_client.has_payment_method(customer_id),
        "publishableKey": stripe_client.publishable_key(),
    }


@account_router.post("/setup-intent")
def account_setup_intent(principal: dict = Depends(deps.require_account)) -> dict:
    """Create a SetupIntent to save a card on the account's customer. A
    SetupIntent never charges — it only stores the payment method."""
    if not stripe_client.configured():
        raise HTTPException(status_code=400, detail="Payments are not enabled.")
    with get_control_connection() as conn:
        customer_id = _ensure_account_customer(conn, principal)
    client_secret = stripe_client.create_setup_intent(customer_id)
    return {"clientSecret": client_secret, "publishableKey": stripe_client.publishable_key()}


class BillingIn(BaseModel):
    spending_limit_eur: float | None = None


class SubscribeIn(BaseModel):
    cadence: str = "monthly"  # "monthly" | "annual"
    promo_code: str | None = None


class PromoIn(BaseModel):
    code: str


def charge_restaurant_owner(conn, restaurant_id: int, amount_cents: int,
                            description: str, idempotency_key: str) -> dict:
    """Charge a campaign event to the owning account's saved card (the card
    collected at onboarding). This is the single entry point campaigns use to
    move money off the card — launch fee, creator payout, end-of-campaign
    settlement. Never raises; returns the charge result dict."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.stripe_customer_id FROM accounts a"
            " JOIN memberships m ON m.account_id = a.id"
            " WHERE m.restaurant_id = %s AND m.role = 'owner'"
            " ORDER BY m.account_id LIMIT 1",
            (restaurant_id,),
        )
        row = cur.fetchone()
    customer_id = row[0] if row else None
    return stripe_client.charge_off_session(customer_id, amount_cents, description, idempotency_key)


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
        promo_id = None
        if body.promo_code:
            promo = stripe_client.lookup_promo(body.promo_code)
            if not promo:
                raise HTTPException(status_code=400, detail="That code is invalid or expired.")
            promo_id = promo["id"]
        customer_id = _ensure_customer(conn, rid, principal["email"])
        result = stripe_client.create_subscription(customer_id, cadence, promotion_code=promo_id)
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


@router.post("/{restaurant_id}/billing/promo")
def check_promo(body: PromoIn,
                ctx: dict = Depends(restaurant_ctx),
                _: dict = Depends(deps.require_account)) -> dict:
    """Validate a promo code the user typed, so the payment step can show the
    discount before they pay. Returns {valid, percentOff, amountOff, code}."""
    promo = stripe_client.lookup_promo(body.code)
    if not promo:
        return {"valid": False}
    return {
        "valid": True,
        "code": promo["code"],
        "percentOff": promo["percentOff"],
        "amountOff": promo["amountOff"],
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
    etype = event["type"]

    # Service booking (creator OR account): Checkout completed → record it
    # (idempotent). The confirm-on-return endpoint records the same booking;
    # whichever lands first wins via the UNIQUE session id.
    if etype == "checkout.session.completed":
        md = obj.get("metadata") or {}
        paid = obj.get("payment_status") in ("paid", "no_payment_required")
        creator_id = md.get("creator_id")
        account_id = md.get("account_id")
        if paid and (creator_id or account_id):
            table = "creator_service_bookings" if creator_id else "account_service_bookings"
            subject_col = "creator_id" if creator_id else "account_id"
            subject_id = int(creator_id or account_id)
            with get_control_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {table} ({subject_col}, product_id, price_id,"
                    "   name, amount_cents, currency, interval, status,"
                    "   stripe_checkout_session_id, stripe_subscription_id, stripe_payment_intent_id)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s, %s)"
                    " ON CONFLICT (stripe_checkout_session_id) DO NOTHING",
                    (subject_id, md.get("product_id") or "", md.get("price_id") or "",
                     md.get("service_name") or "Service", obj.get("amount_total"),
                     obj.get("currency") or "eur", md.get("interval") or None,
                     obj.get("id"), obj.get("subscription"), obj.get("payment_intent")),
                )
                conn.commit()
        return {"received": True}

    sub_id = None
    status = None
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


@router.get("/{restaurant_id}/billing")
def get_billing(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Billing summary for the account UI: spending limit + live subscription
    status (platform fee + usage), including trial and next-payment dates."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT spending_limit_eur, stripe_subscription_id,"
            " stripe_subscription_status, stripe_usage_subscription_id"
            " FROM restaurants WHERE id = %s",
            (rid,),
        )
        limit, sub_id, stored_status, usage_id = cur.fetchone()
    platform = stripe_client.subscription_detail(sub_id) if stripe_client.enabled() else None
    if platform is None and stored_status:
        platform = {"status": stored_status}
    usage = stripe_client.subscription_detail(usage_id) if stripe_client.enabled() else None
    return {
        "spending_limit_eur": float(limit) if limit is not None else None,
        "platform": platform,
        "usage": usage,
    }


@router.post("/{restaurant_id}/billing/cancel")
def cancel_billing(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Cancel the plan at period end — access stays until then, no more charges.
    Applies to both the platform-fee and usage subscriptions."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT stripe_subscription_id, stripe_usage_subscription_id"
            " FROM restaurants WHERE id = %s",
            (rid,),
        )
        sub_id, usage_id = cur.fetchone()
    stripe_client.cancel_at_period_end(sub_id)
    stripe_client.cancel_at_period_end(usage_id)
    return {"ok": True}


@router.put("/{restaurant_id}/billing")
def set_billing(body: BillingIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Store the monthly spending limit (Stripe subscription wired in Phase 6)."""
    rid = ctx["restaurant_id"]
    limit = Decimal(str(body.spending_limit_eur)) if body.spending_limit_eur is not None else None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE restaurants SET spending_limit_eur = %s WHERE id = %s", (limit, rid))
        conn.commit()
    return {"ok": True, "spending_limit_eur": body.spending_limit_eur}


# ---- Restaurant/locale services (bookable Stripe products) -----------------

class ServiceCheckoutIn(BaseModel):
    price_id: str


class ServiceConfirmIn(BaseModel):
    session_id: str


def record_account_booking(conn, account_id: int, session: dict) -> dict | None:
    """Idempotently record an account's service booking from a completed Checkout
    Session. Returns the booking row, or None if the session isn't paid/complete."""
    if session.get("status") != "complete" or \
            session.get("payment_status") not in ("paid", "no_payment_required"):
        return None
    svc = next((s for s in stripe_client.list_restaurant_services()
                if s["price_id"] == session.get("price_id")), None)
    name = (svc or {}).get("name") or session["metadata"].get("service_name") or "Service"
    amount = session.get("amount_total")
    if amount is None:
        amount = (svc or {}).get("amount")
    interval = (svc or {}).get("interval")
    product_id = session.get("product_id") or session["metadata"].get("product_id") or ""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO account_service_bookings (account_id, product_id, price_id, name,"
            "   amount_cents, currency, interval, status, stripe_checkout_session_id,"
            "   stripe_subscription_id, stripe_payment_intent_id)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s, %s)"
            " ON CONFLICT (stripe_checkout_session_id) DO NOTHING"
            " RETURNING id, product_id, price_id, name, amount_cents, currency,"
            "   interval, status, booked_at",
            (account_id, product_id, session.get("price_id"), name, amount,
             session.get("currency") or "eur", interval, session["id"],
             session.get("subscription"), session.get("payment_intent")),
        )
        row = cur.fetchone()
        conn.commit()
    return row


@account_services_router.get("/services")
def account_services(principal: dict = Depends(deps.require_account)) -> dict:
    """Bookable restaurant services (live from Stripe) + this account's bookings."""
    catalog = stripe_client.list_restaurant_services()
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, product_id, price_id, name, amount_cents, currency, interval,"
            "   status, booked_at FROM account_service_bookings"
            " WHERE account_id = %s AND status = 'active' ORDER BY booked_at DESC",
            (principal["id"],),
        )
        booked = cur.fetchall()
    return {"stripeEnabled": stripe_client.enabled(), "catalog": catalog, "booked": booked}


@account_services_router.post("/services/checkout")
def account_service_checkout(body: ServiceCheckoutIn,
                             principal: dict = Depends(deps.require_account)) -> dict:
    """Create a Stripe Checkout Session for one restaurant service; return its URL."""
    if not stripe_client.enabled():
        raise HTTPException(status_code=400, detail="Payments are not enabled.")
    svc = next((s for s in stripe_client.list_restaurant_services()
                if s["price_id"] == body.price_id), None)
    if not svc:
        raise HTTPException(status_code=404, detail="Unknown service.")
    with get_control_connection() as conn:
        customer_id = _ensure_account_customer(conn, principal)
    mode = "subscription" if svc["recurring"] else "payment"
    front = config.APP_BASE_URL.rstrip("/")
    session = stripe_client.create_checkout_session(
        customer_id, svc["price_id"], mode,
        success_url=f"{front}/account?service=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{front}/account?service=cancelled",
        metadata={
            "account_id": str(principal["id"]),
            "price_id": svc["price_id"],
            "product_id": svc["product_id"],
            "service_name": svc["name"],
            "interval": svc["interval"] or "",
        },
    )
    return {"url": session["url"]}


@account_services_router.post("/services/confirm")
def account_service_confirm(body: ServiceConfirmIn,
                            principal: dict = Depends(deps.require_account)) -> dict:
    """Record the booking after Checkout returns to the success URL (works
    without a webhook). Verifies the session belongs to this account."""
    session = stripe_client.retrieve_checkout_session(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Unknown checkout session.")
    if session["metadata"].get("account_id") != str(principal["id"]):
        raise HTTPException(status_code=403, detail="This checkout session isn't yours.")
    with get_control_connection() as conn:
        row = record_account_booking(conn, principal["id"], session)
    return {"booked": row is not None, "booking": row}
