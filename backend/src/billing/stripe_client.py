"""Stripe wrapper: customer + platform-fee subscription (monthly | annual).
Metered usage billing arrives in a later phase."""
from __future__ import annotations

import os
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import stripe

from .. import config

_BERLIN = ZoneInfo("Europe/Berlin")


def _trial_end_ts() -> int | None:
    """Unix timestamp for the configured launch date (start of day, Berlin),
    or None if unset, unparseable, or already in the past."""
    raw = config.STRIPE_SUBSCRIPTION_START
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw.strip())
    except ValueError:
        return None
    start = datetime.combine(d, time(0, 0), tzinfo=_BERLIN)
    ts = int(start.timestamp())
    return ts if ts > int(datetime.now(tz=_BERLIN).timestamp()) else None


def deferred_start() -> bool:
    """True when new subscriptions trial until a future launch date (so the
    card is collected now via a SetupIntent, not charged until then)."""
    return _trial_end_ts() is not None


def lookup_promo(code: str) -> dict | None:
    """Validate a user-entered promo code against Stripe. Returns the active
    promotion code + its discount, or None if it doesn't exist / isn't active.
    Shape: {"id": "promo_…", "code": "WELCOME", "percentOff": 20, "amountOff": 0}."""
    code = (code or "").strip()
    if not code or not _secret():
        return None
    _client()
    try:
        # Codes are stored as created (usually upper-case); try as typed, then upper.
        found = stripe.PromotionCode.list(code=code, active=True, limit=1).data
        if not found and code != code.upper():
            found = stripe.PromotionCode.list(code=code.upper(), active=True, limit=1).data
    except Exception:
        return None
    if not found:
        return None
    pc = found[0]
    c = pc.coupon
    if not c.valid:
        return None
    return {
        "id": pc.id,
        "code": pc.code,
        "percentOff": c.percent_off or 0,
        "amountOff": c.amount_off or 0,  # in cents
    }


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
    # Card only — no Klarna / other methods on the Payment Element.
    intent = stripe.SetupIntent.create(
        customer=customer_id, usage="off_session", payment_method_types=["card"],
    )
    return intent.client_secret


def has_payment_method(customer_id: str | None) -> bool:
    """True if the customer has at least one card on file."""
    if not customer_id:
        return False
    _client()
    pms = stripe.PaymentMethod.list(customer=customer_id, type="card", limit=1)
    return bool(pms.data)


def default_payment_method(customer_id: str | None) -> str | None:
    """The card to charge off-session: the customer's default, else its newest card."""
    if not customer_id:
        return None
    _client()
    cust = stripe.Customer.retrieve(customer_id)
    dpm = (cust.get("invoice_settings") or {}).get("default_payment_method")
    if dpm:
        return dpm
    pms = stripe.PaymentMethod.list(customer=customer_id, type="card", limit=1)
    return pms.data[0].id if pms.data else None


def charge_off_session(customer_id: str | None, amount_cents: int, description: str,
                       idempotency_key: str) -> dict:
    """Charge the customer's saved card off-session (merchant-initiated). This is
    the ONLY function that moves money off a locale account's card. It never runs
    a subscription — every charge is a discrete, idempotent campaign event.

    Returns {charged, id, status, reason}. Never raises: a missing card or a
    decline is reported, not thrown, so the campaign flow isn't blocked.
    """
    if amount_cents <= 0:
        return {"charged": False, "id": None, "status": "skipped", "reason": "zero_amount"}
    if not configured():
        return {"charged": False, "id": None, "status": "skipped", "reason": "stripe_off"}
    pm = default_payment_method(customer_id)
    if not pm:
        return {"charged": False, "id": None, "status": "skipped", "reason": "no_card"}
    _client()
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency="eur",
            customer=customer_id,
            payment_method=pm,
            off_session=True,
            confirm=True,
            description=description,
            idempotency_key=idempotency_key,
        )
        return {"charged": intent.status == "succeeded", "id": intent.id,
                "status": intent.status, "reason": None}
    except stripe.error.CardError as e:  # declined / auth required
        pi = getattr(e, "error", None) and getattr(e.error, "payment_intent", None)
        return {"charged": False, "id": (pi or {}).get("id"), "status": "failed",
                "reason": "card_declined"}
    except stripe.error.StripeError as e:
        return {"charged": False, "id": None, "status": "failed",
                "reason": type(e).__name__}


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


def create_subscription(customer_id: str, cadence: str, promotion_code: str | None = None) -> dict:
    """Create an *incomplete* platform-fee subscription and return the first
    invoice's PaymentIntent client secret for the frontend to confirm.

    'incomplete' means NOTHING is charged until the card is confirmed on the
    frontend — so creating (and cancelling) one moves zero money.

    `promotion_code` is a Stripe promotion-code id (from lookup_promo); when
    given, its coupon is applied to the subscription.
    """
    _client()
    kwargs = dict(
        customer=customer_id,
        items=[{"price": _price_for(cadence)}],
        payment_behavior="default_incomplete",
        payment_settings={
            "save_default_payment_method": "on_subscription",
            # Card only: it supports the variable off-session charges that the
            # metered usage subscription needs later. Klarna cannot.
            "payment_method_types": ["card"],
        },
        expand=["latest_invoice.payment_intent", "pending_setup_intent"],
    )
    trial_ts = _trial_end_ts()
    if trial_ts:
        # Trial until the launch date → no charge now; first payment lands then.
        kwargs["trial_end"] = trial_ts
        kwargs["trial_settings"] = {"end_behavior": {"missing_payment_method": "cancel"}}
    # A user-entered promo code (validated via lookup_promo) applies its coupon.
    # With a trial, a duration=once coupon lands on the first real invoice, not
    # the €0 trial invoice.
    if promotion_code:
        kwargs["discounts"] = [{"promotion_code": promotion_code}]
    sub = stripe.Subscription.create(**kwargs)

    # With a trial the first invoice is €0, so Stripe gives a SetupIntent to
    # collect the card (confirm mode "setup"); otherwise it's a PaymentIntent
    # for the first charge (confirm mode "payment").
    psi = getattr(sub, "pending_setup_intent", None)
    pi = getattr(sub.latest_invoice, "payment_intent", None) if sub.latest_invoice else None
    if psi:
        client_secret, mode = psi.client_secret, "setup"
    else:
        client_secret, mode = (pi.client_secret if pi else None), "payment"
    return {
        "subscription_id": sub.id,
        "status": sub.status,
        "client_secret": client_secret,
        "mode": mode,
    }


def cancel_subscription(subscription_id: str | None) -> None:
    """Cancel immediately (used by delete flows). No-op on empty ids and on a
    subscription Stripe already forgot (e.g. cancelled earlier)."""
    if not subscription_id:
        return
    _client()
    try:
        stripe.Subscription.delete(subscription_id)
    except stripe.error.InvalidRequestError:
        pass  # already gone / never existed


def cancel_at_period_end(subscription_id: str | None) -> None:
    """Schedule cancellation at the end of the paid period (used by 'cancel
    plan'): access continues, no further charges. No-op on empty ids."""
    if not subscription_id:
        return
    _client()
    try:
        stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)
    except stripe.error.InvalidRequestError:
        pass


def subscription_detail(subscription_id: str | None) -> dict | None:
    """Live status of a subscription for the account UI, or None if absent."""
    if not subscription_id:
        return None
    _client()
    try:
        s = stripe.Subscription.retrieve(subscription_id)
    except stripe.error.InvalidRequestError:
        return None
    items = s["items"]["data"]
    price_id = items[0]["price"]["id"] if items else None
    cadence = ("annual" if price_id == config.STRIPE_PRICE_ANNUAL
               else "monthly" if price_id == config.STRIPE_PRICE_MONTHLY else None)
    return {
        "status": s.status,
        "cadence": cadence,
        "cancel_at_period_end": bool(s.cancel_at_period_end),
        "current_period_end": s.current_period_end,  # unix seconds
        "trial_end": s.trial_end,
    }


# ---- Usage billing (metered views) ---------------------------------------

def usage_enabled() -> bool:
    """Ready to bill views: secret key + metered price + meter event name."""
    return bool(_secret() and config.STRIPE_PRICE_USAGE and config.STRIPE_METER_EVENT_NAME)


def ensure_usage_subscription(customer_id: str) -> str:
    """Return the customer's monthly metered usage subscription, creating it if
    needed. It has a €0 base, so creating it charges nothing; usage accrues via
    meter events and is invoiced at period end against the default payment
    method (set when the platform-fee subscription was confirmed)."""
    _client()
    # Reuse an existing active usage subscription on the metered price.
    subs = stripe.Subscription.list(customer=customer_id, status="active", limit=100)
    for s in subs.auto_paging_iter():
        for it in s["items"]["data"]:
            if it["price"]["id"] == config.STRIPE_PRICE_USAGE:
                return s.id
    sub = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": config.STRIPE_PRICE_USAGE}],
        payment_settings={"payment_method_types": ["card"]},
    )
    return sub.id


def report_view_usage(customer_id: str, views: int, identifier: str) -> None:
    """Report billable views to the Stripe meter. `identifier` makes the event
    idempotent so a retried poll can't double-bill."""
    _client()
    stripe.billing.MeterEvent.create(
        event_name=config.STRIPE_METER_EVENT_NAME,
        payload={"stripe_customer_id": customer_id, "value": str(int(views))},
        identifier=identifier,
    )


def construct_event(payload: bytes, sig_header: str):
    """Verify + parse a webhook event (raises on bad signature)."""
    _client()
    return stripe.Webhook.construct_event(payload, sig_header, config.STRIPE_WEBHOOK_SECRET)
