"""Signed-JWT session cookie: issue, read, clear."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Request, Response

from .. import config

_ALG = "HS256"


def issue_session(response: Response, *, subject_type: str, subject_id: int,
                  email_verified: bool) -> None:
    """Set the session cookie for a principal (account | creator)."""
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


def read_session(request: Request) -> dict | None:
    """Decode the session cookie, or None if missing/invalid/expired."""
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        return None
    try:
        return jwt.decode(token, config.SESSION_SECRET, algorithms=[_ALG])
    except jwt.PyJWTError:
        return None


def clear_session(response: Response) -> None:
    response.delete_cookie(config.COOKIE_NAME, path="/")
