"""Public config: feature flags + Stripe publishable key + pricing."""
from __future__ import annotations

from fastapi import APIRouter

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
        "pricing": {"ratePerView": 0.01, "platformFee": 50, "creatorPerView": 0.002},
    }
