"""Single-use email verification / reset tokens (hashed at rest)."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import psycopg

from .. import config


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(conn: psycopg.Connection, *, subject_type: str, subject_id: int,
                purpose: str = "verify", ttl_hours: int | None = None) -> str:
    """Create a token row (storing only its hash) and return the RAW token."""
    raw = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(
        hours=ttl_hours or config.VERIFY_TOKEN_TTL_HOURS
    )
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth_tokens (subject_type, subject_id, purpose, token_hash, expires_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (subject_type, subject_id, purpose, _hash(raw), expires),
        )
    conn.commit()
    return raw


def consume_token(conn: psycopg.Connection, raw: str, purpose: str = "verify") -> tuple[str, int] | None:
    """Spend a valid, unexpired, unconsumed token. Returns (subject_type, subject_id) or None."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE auth_tokens SET consumed_at = NOW()"
            " WHERE token_hash = %s AND purpose = %s AND consumed_at IS NULL"
            "   AND expires_at > NOW()"
            " RETURNING subject_type, subject_id",
            (_hash(raw), purpose),
        )
        row = cur.fetchone()
    conn.commit()
    return (row[0], row[1]) if row else None
