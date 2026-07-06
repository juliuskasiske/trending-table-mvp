"""Instagram API with Instagram Login (Meta).

The creator logs in with Instagram directly and grants insights access — no
linked Facebook Page needed. Business/Creator accounts only. All credentials
come from the env (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / redirect URI),
which are the *Instagram* app's id/secret, not the top-level Meta app id.
"""
from __future__ import annotations

from urllib.parse import urlencode

import httpx

from .. import config

# Read the creator's profile + insights.
SCOPES = "instagram_business_basic,instagram_business_manage_insights"

_AUTHORIZE = "https://www.instagram.com/oauth/authorize"
_TOKEN = "https://api.instagram.com/oauth/access_token"
_GRAPH = "https://graph.instagram.com"
_TIMEOUT = 15


def enabled() -> bool:
    return bool(
        config.INSTAGRAM_APP_ID and config.INSTAGRAM_APP_SECRET and config.INSTAGRAM_REDIRECT_URI
    )


def authorize_url(state: str) -> str:
    """The Instagram authorization window the creator is sent to."""
    q = urlencode({
        "client_id": config.INSTAGRAM_APP_ID,
        "redirect_uri": config.INSTAGRAM_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    })
    return f"{_AUTHORIZE}?{q}"


def exchange_code(code: str) -> dict:
    """Trade the callback code for a short-lived token (~1h) + the IG user id."""
    r = httpx.post(_TOKEN, data={
        "client_id": config.INSTAGRAM_APP_ID,
        "client_secret": config.INSTAGRAM_APP_SECRET,
        "grant_type": "authorization_code",
        "redirect_uri": config.INSTAGRAM_REDIRECT_URI,
        "code": code,
    }, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()  # { access_token, user_id, permissions }


def long_lived_token(short_token: str) -> dict:
    """Exchange a short-lived token for a long-lived one (~60 days)."""
    r = httpx.get(f"{_GRAPH}/access_token", params={
        "grant_type": "ig_exchange_token",
        "client_secret": config.INSTAGRAM_APP_SECRET,
        "access_token": short_token,
    }, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()  # { access_token, token_type, expires_in }


def profile(token: str) -> dict:
    """The connected account's handle + follower count + type."""
    r = httpx.get(f"{_GRAPH}/me", params={
        "fields": "user_id,username,account_type,followers_count,media_count",
        "access_token": token,
    }, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()  # { user_id, username, account_type, followers_count, media_count }
