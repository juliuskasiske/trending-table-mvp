"""Auth routes: signup / login / logout / me / verify / resend (both sides)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr

from .. import deps
from ... import audit, config
from ...auth import email as email_mod
from ...auth import passwords, sessions, store, tokens
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


def _audit_kwargs(role: str, subject_id: int) -> dict:
    return {"account_id": subject_id} if role == "account" else {"creator_id": subject_id}


@router.post("/signup")
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
    sessions.issue_session(response, subject_type=body.role, subject_id=row["id"], email_verified=False)

    out = {"id": row["id"], "email": row["email"], "role": body.role, "email_verified": False}
    if config.IS_DEV:
        out["dev_verify_token"] = raw  # dev-only convenience for testing
    return out


@router.post("/login")
def login(body: LoginIn, response: Response) -> dict:
    with get_control_connection() as conn:
        row = store.get_by_email(conn, body.role, body.email)
        if not row:
            raise HTTPException(status_code=401, detail="Invalid email or password.")
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
    sessions.issue_session(response, subject_type=body.role, subject_id=row["id"], email_verified=verified)
    return {"id": row["id"], "email": row["email"], "role": body.role, "email_verified": verified}


@router.post("/logout")
def logout(response: Response) -> dict:
    sessions.clear_session(response)
    return {"ok": True}


@router.get("/me")
def me(principal: dict = Depends(deps.current_principal)) -> dict:
    return principal


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


@router.post("/resend-verification")
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
