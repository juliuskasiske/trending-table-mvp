"""Row access for the two identity tables (accounts | creators)."""
from __future__ import annotations

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

_TABLES = {"account": "accounts", "creator": "creators"}


def _ident(role: str) -> sql.Identifier:
    return sql.Identifier(_TABLES[role])


def get_by_email(conn: psycopg.Connection, role: str, email: str) -> dict | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            sql.SQL("SELECT * FROM {} WHERE email = %s").format(_ident(role)),
            (email.strip().lower(),),
        )
        return cur.fetchone()


def get_by_id(conn: psycopg.Connection, role: str, subject_id: int) -> dict | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            sql.SQL("SELECT * FROM {} WHERE id = %s").format(_ident(role)),
            (subject_id,),
        )
        return cur.fetchone()


def create(conn: psycopg.Connection, role: str, email: str, password_hash: str,
           display_name: str | None) -> dict:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            sql.SQL(
                "INSERT INTO {} (email, password_hash, display_name)"
                " VALUES (%s, %s, %s) RETURNING *"
            ).format(_ident(role)),
            (email.strip().lower(), password_hash, display_name),
        )
        row = cur.fetchone()
    conn.commit()
    return row


def mark_verified(conn: psycopg.Connection, role: str, subject_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                "UPDATE {} SET email_verified_at = NOW()"
                " WHERE id = %s AND email_verified_at IS NULL"
            ).format(_ident(role)),
            (subject_id,),
        )
    conn.commit()


def register_failed_login(conn: psycopg.Connection, role: str, subject_id: int,
                          max_attempts: int, lockout_minutes: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                "UPDATE {} SET failed_attempts = failed_attempts + 1,"
                " locked_until = CASE WHEN failed_attempts + 1 >= %s"
                "   THEN NOW() + make_interval(mins => %s) ELSE locked_until END"
                " WHERE id = %s"
            ).format(_ident(role)),
            (max_attempts, lockout_minutes, subject_id),
        )
    conn.commit()


def reset_failed_login(conn: psycopg.Connection, role: str, subject_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("UPDATE {} SET failed_attempts = 0, locked_until = NULL WHERE id = %s")
            .format(_ident(role)),
            (subject_id,),
        )
    conn.commit()
