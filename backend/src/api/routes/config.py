"""Public config: feature flags + Stripe publishable key + pricing."""
from __future__ import annotations

from fastapi import APIRouter

from ... import config
from ...billing import stripe_client
from ...integrations import digitize, places

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config")
def config() -> dict:
    return {
        "placesEnabled": places.enabled(),
        "menuAiEnabled": digitize.markitdown_available(),
        "menuLlmEnabled": digitize.llm_enabled(),
        "stripeEnabled": stripe_client.configured(),
        "stripePublishableKey": stripe_client.publishable_key(),
        "stripePrices": stripe_client.prices(),
        # When true, the platform-fee subscription trials until a launch date,
        # so the card is saved now (SetupIntent) and first charged then.
        "subscriptionDeferredStart": stripe_client.deferred_start(),
        "subscriptionStart": config.STRIPE_SUBSCRIPTION_START or None,
        "pricing": {"ratePerView": 0.01, "platformFee": 50, "creatorPerView": 0.002},
    }
