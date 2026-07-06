"""Shared FastAPI dependencies."""
from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

from .. import config
from ..auth import store
from ..auth.sessions import read_session
from ..db.connection import get_control_connection
from .ratelimit import rate_limit

_admin_throttle = rate_limit("admin", 30, 60)


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
    if row.get("deleted_at"):  # soft-deleted account: kill the session
        raise HTTPException(status_code=401, detail="This account was deleted")

    return {
        "id": row["id"],
        "email": row["email"],
        "role": role,
        "display_name": row.get("display_name"),
        "email_verified": row.get("email_verified_at") is not None,
    }


def require_admin(request: Request) -> None:
    """Owner-only 'control tower' access via a single key (X-Admin-Key header).

    No account/email involved — the key lives in ADMIN_KEY (.env).
    """
    _admin_throttle(request)  # throttle key guesses per IP
    if not config.ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Control tower is not configured.")
    key = request.headers.get("x-admin-key", "")
    if not hmac.compare_digest(key, config.ADMIN_KEY):
        raise HTTPException(status_code=403, detail="Invalid admin key.")


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
    """Return the account's role on the restaurant, or 404 if not a member
    (or the restaurant has been soft-deleted)."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT m.role FROM memberships m JOIN restaurants r ON r.id = m.restaurant_id"
            " WHERE m.account_id = %s AND m.restaurant_id = %s AND r.status <> 'deleted'",
            (account_id, restaurant_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Restaurant not found.")
    return row[0]
