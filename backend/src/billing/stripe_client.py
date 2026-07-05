"""Stripe wrapper: customer + platform-fee subscription (monthly | annual).
Metered usage billing arrives in a later phase."""
from __future__ import annotations

import os

import stripe

from .. import config


def _secret() -> str:
    return os.environ.get("STRIPE_SECRET_KEY", "")


def enabled() -> bool:
    return bool(_secret())


def configured() -> bool:
    """Fully ready to sell: secret key + both platform-fee price IDs set."""
    return bool(_secret() and config.STRIPE_PRICE_MONTHLY and config.STRIPE_PRICE_ANNUAL)


def publishable_key() -> str | None:
    return os.environ.get("STRIPE_PUBLISHABLE_KEY") or None


def _client() -> None:
    stripe.api_key = _secret()


def create_customer(email: str | None, name: str | None) -> str:
    _client()
    customer = stripe.Customer.create(email=email, name=name)
    return customer.id


def create_setup_intent(customer_id: str) -> str:
    _client()
    intent = stripe.SetupIntent.create(customer=customer_id, usage="off_session")
    return intent.client_secret


def _price_for(cadence: str) -> str:
    price = config.STRIPE_PRICE_ANNUAL if cadence == "annual" else config.STRIPE_PRICE_MONTHLY
    if not price:
        raise RuntimeError(f"No Stripe price configured for cadence '{cadence}'.")
    return price


_price_cache: dict[str, dict] = {}


def prices() -> dict:
    """The real platform-fee amounts, straight from Stripe (cached per process).
    Shape: {"monthly": {"amount": <cents>, "currency": "eur"}, "annual": {...}}.
    Returns {} if Stripe isn't configured or is unreachable — callers must cope."""
    if not configured():
        return {}
    out: dict = {}
    _client()
    for cadence in ("monthly", "annual"):
        pid = _price_for(cadence)
        try:
            if pid not in _price_cache:
                p = stripe.Price.retrieve(pid)
                _price_cache[pid] = {"amount": p.unit_amount, "currency": p.currency}
            out[cadence] = _price_cache[pid]
        except Exception:
            return {}
    return out


def create_subscription(customer_id: str, cadence: str) -> dict:
    """Create an *incomplete* platform-fee subscription and return the first
    invoice's PaymentIntent client secret for the frontend to confirm.

    'incomplete' means NOTHING is charged until the card is confirmed on the
    frontend — so creating (and cancelling) one moves zero money.
    """
    _client()
    sub = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": _price_for(cadence)}],
        payment_behavior="default_incomplete",
        payment_settings={"save_default_payment_method": "on_subscription"},
        expand=["latest_invoice.payment_intent"],
    )
    pi = getattr(sub.latest_invoice, "payment_intent", None)
    return {
        "subscription_id": sub.id,
        "status": sub.status,
        "client_secret": pi.client_secret if pi else None,
    }


def cancel_subscription(subscription_id: str) -> None:
    _client()
    stripe.Subscription.delete(subscription_id)


def construct_event(payload: bytes, sig_header: str):
    """Verify + parse a webhook event (raises on bad signature)."""
    _client()
    return stripe.Webhook.construct_event(payload, sig_header, config.STRIPE_WEBHOOK_SECRET)
