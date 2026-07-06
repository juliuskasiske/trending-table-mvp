"""Instagram API with Instagram Login (Meta).

The creator logs in with Instagram directly and grants insights access — no
linked Facebook Page needed. Business/Creator accounts only. All credentials
come from the env (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / redirect URI),
which are the *Instagram* app's id/secret, not the top-level Meta app id.
"""
from __future__ import annotations

import re
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


_MEDIA_FIELDS = (
    "id,permalink,media_type,media_product_type,thumbnail_url,media_url,"
    "caption,timestamp,like_count,comments_count"
)


def _shortcode(url: str) -> str | None:
    """The stable id in an Instagram post URL: /p/<x>, /reel/<x>, or /tv/<x>."""
    m = re.search(r"instagram\.com/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", url or "")
    return m.group(1) if m else None


def media_by_permalink(token: str, permalink: str) -> dict | None:
    """Resolve a submitted post URL to the creator's media object. The URL's
    shortcode is not the API media id, so we page /me/media and match on the
    permalink's shortcode. Returns the media dict (with the real id) or None."""
    target = _shortcode(permalink)
    if not target:
        return None
    url = f"{_GRAPH}/me/media"
    params = {"fields": _MEDIA_FIELDS, "limit": 50, "access_token": token}
    for _ in range(6):  # up to ~300 recent posts
        r = httpx.get(url, params=params, timeout=_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        for m in body.get("data", []):
            if _shortcode(m.get("permalink", "")) == target:
                return m
        nxt = (body.get("paging") or {}).get("next")
        if not nxt:
            break
        url, params = nxt, None  # `next` is a fully-formed URL
    return None


def media_insights(token: str, media_id: str, product_type: str | None) -> dict:
    """Live counts for one media. Reels expose 'views'; older/other media fall
    back to 'reach'. Best-effort — returns {} if insights aren't available."""
    metrics = "views,reach,total_interactions" if (product_type or "").upper() == "REELS" else "reach"
    try:
        r = httpx.get(f"{_GRAPH}/{media_id}/insights",
                      params={"metric": metrics, "access_token": token}, timeout=_TIMEOUT)
        r.raise_for_status()
        out: dict = {}
        for row in r.json().get("data", []):
            vals = row.get("values") or [{}]
            out[row.get("name")] = vals[0].get("value")
        return out
    except Exception:
        return {}
