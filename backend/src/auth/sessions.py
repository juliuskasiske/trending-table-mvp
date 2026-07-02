"""Signed-JWT session cookie: issue, read, clear."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Request, Response

from .. import config

_ALG = "HS256"


def issue_session(response: Response, *, subject_type: str, subject_id: int,
                  email_verified: bool) -> str:
    """Set the session cookie for a principal and return the raw token.

    The token is also returned so callers can send it in the response body; the
    frontend echoes it back as an ``Authorization: Bearer`` header. This keeps
    auth working in browsers that refuse to persist the cookie (e.g. Safari on
    the bare ``localhost`` hostname), where the httponly cookie alone is unused.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject_id),
        "typ": subject_type,
        "ev": email_verified,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=config.SESSION_TTL_HOURS)).timestamp()),
    }
    token = jwt.encode(payload, config.SESSION_SECRET, algorithm=_ALG)
    response.set_cookie(
        config.COOKIE_NAME,
        token,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        max_age=config.SESSION_TTL_HOURS * 3600,
        path="/",
    )
    return token


def _token_from_request(request: Request) -> str | None:
    """The session token from the cookie, or an ``Authorization: Bearer`` header."""
    token = request.cookies.get(config.COOKIE_NAME)
    if token:
        return token
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


def read_session(request: Request) -> dict | None:
    """Decode the session token (cookie or Bearer header); None if missing/invalid."""
    token = _token_from_request(request)
    if not token:
        return None
    try:
        return jwt.decode(token, config.SESSION_SECRET, algorithms=[_ALG])
    except jwt.PyJWTError:
        return None


def clear_session(response: Response) -> None:
    response.delete_cookie(config.COOKIE_NAME, path="/")
