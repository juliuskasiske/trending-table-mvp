"""Runtime configuration, read from the environment (.env)."""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0") == "1"


# Auth / sessions
SESSION_SECRET = os.environ.get("SESSION_SECRET", "dev-insecure-secret-change-me")
SESSION_TTL_HOURS = int(os.environ.get("SESSION_TTL_HOURS", "168"))  # 7 days
COOKIE_NAME = "tt_session"
COOKIE_SECURE = _bool("COOKIE_SECURE", False)  # set 1 in production (HTTPS)
IS_DEV = not COOKIE_SECURE

# Where the SPA lives — used to build email verification links.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5174")
VERIFY_TOKEN_TTL_HOURS = int(os.environ.get("VERIFY_TOKEN_TTL_HOURS", "48"))

# Lockout policy
MAX_FAILED_ATTEMPTS = int(os.environ.get("MAX_FAILED_ATTEMPTS", "8"))
LOCKOUT_MINUTES = int(os.environ.get("LOCKOUT_MINUTES", "15"))

# Outbound email (SMTP). When SMTP_HOST is unset we fall back to logging the
# link (dev). Works with any provider: Resend, Postmark, Mailgun, SES, Gmail…
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_STARTTLS = _bool("SMTP_STARTTLS", True)  # STARTTLS on 587; set 0 for a plain dev catcher
SMTP_SSL = _bool("SMTP_SSL", False)  # implicit TLS on 465
MAIL_FROM = os.environ.get("MAIL_FROM", "no-reply@trendingtable.local")
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "Trending Table")

# Owner "control tower" access: a single secret key entered on /admin. Set it
# in .env; unset means the control tower is disabled.
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")

# Stripe — platform-fee subscription. STRIPE_SECRET_KEY read in stripe_client.
# The two price IDs are the €50/mo and annual platform-fee prices.
STRIPE_PRICE_MONTHLY = os.environ.get("STRIPE_PRICE_MONTHLY", "")
STRIPE_PRICE_ANNUAL = os.environ.get("STRIPE_PRICE_ANNUAL", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
# Usage billing: a metered price (€0.01/view) reported through a Stripe Billing
# Meter. Both must be set to bill views; otherwise views are only recorded locally.
STRIPE_PRICE_USAGE = os.environ.get("STRIPE_PRICE_USAGE", "")
STRIPE_METER_EVENT_NAME = os.environ.get("STRIPE_METER_EVENT_NAME", "")
# Optional launch date (ISO YYYY-MM-DD, Europe/Berlin). If set and in the
# future, the platform-fee subscription trials until this date, so the first
# payment lands on it. Once past, new subscriptions start (and bill) immediately.
STRIPE_SUBSCRIPTION_START = os.environ.get("STRIPE_SUBSCRIPTION_START", "")
# "Welcome" first-month discount coupon (duration=once) auto-applied to the
# MONTHLY platform fee. Empty = no discount.
STRIPE_WELCOME_COUPON = os.environ.get("STRIPE_WELCOME_COUPON", "")

# Instagram (Meta "Instagram API with Instagram Login"). These are the
# Instagram app's id/secret (Meta app → Instagram → API setup with Instagram
# login), NOT the top-level Meta app id. Redirect URI must exactly match one
# registered under Business login settings. Empty = the connect step is mocked.
INSTAGRAM_APP_ID = os.environ.get("INSTAGRAM_APP_ID", "")
INSTAGRAM_APP_SECRET = os.environ.get("INSTAGRAM_APP_SECRET", "")
INSTAGRAM_REDIRECT_URI = os.environ.get("INSTAGRAM_REDIRECT_URI", "")

# Campaign redesign: internal rate used only to turn a campaign budget into an
# expected-views estimate (budget ÷ rate). NEVER exposed to restaurants — they
# see the view number, never the €/view. €0.015 = 1.5¢/view.
from decimal import Decimal as _Decimal

VIEW_ESTIMATE_RATE_EUR = _Decimal(os.environ.get("VIEW_ESTIMATE_RATE_EUR", "0.015"))
# The one-time fee (in cents) to launch a campaign. €9.99.
CAMPAIGN_FEE_CENTS = int(os.environ.get("CAMPAIGN_FEE_CENTS", "999"))

# Metrics poller: how often (seconds) the API polls live posts for fresh view
# counts (analytics only now). 0 / unset = disabled (default). In production
# set e.g. 900 (15 min).
try:
    METRICS_POLL_INTERVAL_SECONDS = int(os.environ.get("METRICS_POLL_INTERVAL_SECONDS", "0") or 0)
except ValueError:
    METRICS_POLL_INTERVAL_SECONDS = 0

_INSECURE_SESSION_DEFAULTS = {"dev-insecure-secret-change-me", "dev-session-secret-change-me"}


def validate_production_config() -> None:
    """Refuse to boot a production deploy with weak or missing secrets.

    Production is signalled by COOKIE_SECURE=1 (HTTPS). Fails closed so a
    misconfigured deploy crashes loudly instead of running insecurely.
    """
    if IS_DEV:
        return
    problems: list[str] = []

    if (not SESSION_SECRET or SESSION_SECRET in _INSECURE_SESSION_DEFAULTS
            or len(SESSION_SECRET) < 32):
        problems.append("SESSION_SECRET must be a strong random value (>= 32 chars).")

    key = os.environ.get("APP_SECRET_KEY", "")
    if not key:
        problems.append("APP_SECRET_KEY (Fernet key) must be set.")
    else:
        try:
            from cryptography.fernet import Fernet
            Fernet(key.encode() if isinstance(key, str) else key)
        except Exception:
            problems.append("APP_SECRET_KEY is not a valid Fernet key.")

    if ADMIN_KEY and len(ADMIN_KEY) < 16:
        problems.append("ADMIN_KEY should be at least 16 characters (or unset to disable).")

    if APP_BASE_URL.startswith("http://"):
        problems.append("APP_BASE_URL should be https:// in production.")

    if problems:
        raise RuntimeError(
            "Refusing to start — insecure production config:\n  - " + "\n  - ".join(problems)
        )
