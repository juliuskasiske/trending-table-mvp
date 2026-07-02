"""Shared FastAPI dependencies."""
from __future__ import annotations

from fastapi import HTTPException, Request

from .. import config
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
        "is_admin": role == "account" and config.is_admin_email(row["email"]),
    }


def require_admin(request: Request) -> dict:
    """Owner-only 'control tower' access — the account's email is in ADMIN_EMAILS."""
    principal = current_principal(request)
    if not principal.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access only.")
    return principal


def require_verified(request: Request) -> dict:
    """Like current_principal, but also requires a verified email."""
    principal = current_principal(request)
    if not principal["email_verified"]:
        raise HTTPException(status_code=403, detail="Please verify your email first.")
    return principal


def require_account(request: Request) -> dict:
    """The principal must be a restaurant-side account (not a creator)."""
    principal = current_principal(request)
    if principal["role"] != "account":
        raise HTTPException(status_code=403, detail="Restaurant accounts only.")
    return principal


def require_creator(request: Request) -> dict:
    principal = current_principal(request)
    if principal["role"] != "creator":
        raise HTTPException(status_code=403, detail="Creator accounts only.")
    return principal


def assert_membership(account_id: int, restaurant_id: int) -> str:
    """Return the account's role on the restaurant, or 404 if not a member."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT role FROM memberships WHERE account_id = %s AND restaurant_id = %s",
            (account_id, restaurant_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Restaurant not found.")
    return row[0]
