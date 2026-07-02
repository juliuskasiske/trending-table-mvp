"""Billing routes. Phase 4: SetupIntent (save a card) + spending limit.
Subscriptions + metered usage land in Phase 6."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import deps
from ...billing import stripe_client
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api/restaurants", tags=["billing"])


class BillingIn(BaseModel):
    spending_limit_eur: float | None = None


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


@router.put("/{restaurant_id}/billing")
def set_billing(body: BillingIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Store the monthly spending limit (Stripe subscription wired in Phase 6)."""
    rid = ctx["restaurant_id"]
    limit = Decimal(str(body.spending_limit_eur)) if body.spending_limit_eur is not None else None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE restaurants SET spending_limit_eur = %s WHERE id = %s", (limit, rid))
        conn.commit()
    return {"ok": True, "spending_limit_eur": body.spending_limit_eur}
