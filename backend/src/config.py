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
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173")
VERIFY_TOKEN_TTL_HOURS = int(os.environ.get("VERIFY_TOKEN_TTL_HOURS", "48"))

# Lockout policy
MAX_FAILED_ATTEMPTS = int(os.environ.get("MAX_FAILED_ATTEMPTS", "8"))
LOCKOUT_MINUTES = int(os.environ.get("LOCKOUT_MINUTES", "15"))
