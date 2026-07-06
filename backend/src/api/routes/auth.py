"""Auth routes: signup / login / logout / me / verify / resend (both sides)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr

from .. import deps
from ..ratelimit import rate_limit
from ... import audit, config
from ...auth import email as email_mod
from ...auth import passwords, sessions, store, tokens
from ...billing import stripe_client
from ...db.connection import get_control_connection

router = APIRouter(prefix="/api/auth", tags=["auth"])

Role = Literal["account", "creator"]


class SignupIn(BaseModel):
    email: EmailStr
    password: str
    role: Role = "account"
    display_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    role: Role = "account"


class UpdateMeIn(BaseModel):
    display_name: str | None = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


def _audit_kwargs(role: str, subject_id: int) -> dict:
    return {"account_id": subject_id} if role == "account" else {"creator_id": subject_id}


@router.post("/signup", dependencies=[Depends(rate_limit("signup", 5, 60))])
def signup(body: SignupIn, response: Response) -> dict:
    problem = passwords.password_problem(body.password, body.email)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    with get_control_connection() as conn:
        if store.get_by_email(conn, body.role, body.email):
            raise HTTPException(status_code=409, detail="An account with that email already exists.")
        row = store.create(
            conn, body.role, body.email,
            passwords.hash_password(body.password), body.display_name,
        )
        raw = tokens.issue_token(conn, subject_type=body.role, subject_id=row["id"], purpose="verify")
        audit.record(conn, "signup", actor=body.email, **_audit_kwargs(body.role, row["id"]))

    email_mod.send_verification(body.email, raw)
    token = sessions.issue_session(
        response, subject_type=body.role, subject_id=row["id"], email_verified=False
    )

    out = {
        "id": row["id"], "email": row["email"], "role": body.role,
        "email_verified": False, "token": token,
    }
    if config.IS_DEV:
        out["dev_verify_token"] = raw  # dev-only convenience for testing
    return out


@router.post("/login", dependencies=[Depends(rate_limit("login", 10, 60))])
def login(body: LoginIn, response: Response) -> dict:
    with get_control_connection() as conn:
        row = store.get_by_email(conn, body.role, body.email)
        if not row:
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        if row.get("deleted_at"):
            raise HTTPException(status_code=403, detail="This account was deleted.")
        locked = row.get("locked_until")
        if locked and locked > datetime.now(timezone.utc):
            raise HTTPException(status_code=423, detail="Account temporarily locked. Try again shortly.")
        if not passwords.verify_password(row["password_hash"], body.password):
            store.register_failed_login(
                conn, body.role, row["id"], config.MAX_FAILED_ATTEMPTS, config.LOCKOUT_MINUTES
            )
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        store.reset_failed_login(conn, body.role, row["id"])

    verified = row.get("email_verified_at") is not None
    token = sessions.issue_session(
        response, subject_type=body.role, subject_id=row["id"], email_verified=verified
    )
    return {
        "id": row["id"], "email": row["email"], "role": body.role,
        "email_verified": verified, "token": token,
    }


@router.post("/logout")
def logout(response: Response) -> dict:
    sessions.clear_session(response)
    return {"ok": True}


@router.get("/me")
def me(principal: dict = Depends(deps.current_principal)) -> dict:
    return principal


@router.patch("/me")
def update_me(body: UpdateMeIn, principal: dict = Depends(deps.require_account)) -> dict:
    """Update the account's own profile (display name for now)."""
    if body.display_name is not None:
        with get_control_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE accounts SET display_name = %s WHERE id = %s",
                (body.display_name.strip() or None, principal["id"]),
            )
            conn.commit()
    return {"ok": True}


@router.post("/change-password")
def change_password(body: ChangePasswordIn,
                    principal: dict = Depends(deps.require_account)) -> dict:
    with get_control_connection() as conn:
        row = store.get_by_id(conn, "account", principal["id"])
        if not row or not passwords.verify_password(row["password_hash"], body.current_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        problem = passwords.password_problem(body.new_password, row["email"])
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE accounts SET password_hash = %s WHERE id = %s",
                (passwords.hash_password(body.new_password), principal["id"]),
            )
        audit.record(conn, "password_changed", account_id=principal["id"])
        conn.commit()
    return {"ok": True}


@router.post("/delete-account")
def delete_account(response: Response,
                   principal: dict = Depends(deps.require_account)) -> dict:
    """Soft-delete the account: cancel Stripe billing (platform + usage) on every
    restaurant it owns, tag those restaurants and the account deleted, and end
    the session. Rows are kept in both databases — just tombstoned."""
    aid = principal["id"]
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.stripe_subscription_id, r.stripe_usage_subscription_id"
                " FROM restaurants r JOIN memberships m ON m.restaurant_id = r.id"
                " WHERE m.account_id = %s AND m.role = 'owner' AND r.status <> 'deleted'",
                (aid,),
            )
            owned = cur.fetchall()
        for _rid, sub_id, usage_id in owned:
            stripe_client.cancel_subscription(sub_id)
            stripe_client.cancel_subscription(usage_id)
        with conn.cursor() as cur:
            for rid, *_ in owned:
                cur.execute("UPDATE restaurants SET status = 'deleted' WHERE id = %s", (rid,))
            cur.execute("UPDATE accounts SET deleted_at = NOW() WHERE id = %s", (aid,))
        audit.record(conn, "account_deleted", account_id=aid)
        conn.commit()
    sessions.clear_session(response)
    return {"ok": True}


@router.get("/verify")
def verify(token: str) -> dict:
    with get_control_connection() as conn:
        result = tokens.consume_token(conn, token, "verify")
        if not result:
            raise HTTPException(status_code=400, detail="This verification link is invalid or expired.")
        subject_type, subject_id = result
        store.mark_verified(conn, subject_type, subject_id)
        audit.record(conn, "email_verified", **_audit_kwargs(subject_type, subject_id))
    return {"ok": True}


@router.post("/resend-verification", dependencies=[Depends(rate_limit("resend", 3, 60))])
def resend_verification(principal: dict = Depends(deps.current_principal)) -> dict:
    if principal["email_verified"]:
        return {"ok": True, "already_verified": True}
    with get_control_connection() as conn:
        raw = tokens.issue_token(
            conn, subject_type=principal["role"], subject_id=principal["id"], purpose="verify"
        )
    email_mod.send_verification(principal["email"], raw)
    out = {"ok": True}
    if config.IS_DEV:
        out["dev_verify_token"] = raw
    return out
