"""Shared FastAPI dependencies."""
from __future__ import annotations

from fastapi import HTTPException, Request

from ..auth import store
from ..auth.sessions import read_session
from ..db.connection import get_control_connection


def current_principal(request: Request) -> dict:
    """The logged-in account/creator, loaded fresh from the DB. 401 if not."""
    session = read_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    role = session.get("typ")
    if role not in ("account", "creator"):
        raise HTTPException(status_code=401, detail="Invalid session")
    try:
        subject_id = int(session.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid session")

    with get_control_connection() as conn:
        row = store.get_by_id(conn, role, subject_id)
    if not row:
        raise HTTPException(status_code=401, detail="Account no longer exists")

    return {
        "id": row["id"],
        "email": row["email"],
        "role": role,
        "display_name": row.get("display_name"),
        "email_verified": row.get("email_verified_at") is not None,
    }


def require_verified(request: Request) -> dict:
    """Like current_principal, but also requires a verified email."""
    principal = current_principal(request)
    if not principal["email_verified"]:
        raise HTTPException(status_code=403, detail="Please verify your email first.")
    return principal
