"""Stripe wrapper. Phase 4: customer + SetupIntent (save a card).
Subscriptions + metered usage arrive in Phase 6."""
from __future__ import annotations

import os

import stripe


def _secret() -> str:
    return os.environ.get("STRIPE_SECRET_KEY", "")


def enabled() -> bool:
    return bool(_secret())


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
