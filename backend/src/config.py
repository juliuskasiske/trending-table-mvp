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
