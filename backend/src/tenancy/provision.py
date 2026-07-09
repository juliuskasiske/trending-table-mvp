"""Provisioning a restaurant tenant: control-plane row + membership + app profile."""
from __future__ import annotations

from psycopg.rows import dict_row

from .. import audit
from ..db.connection import app_connection, get_control_connection
from . import repo


def create_restaurant(account_id: int, name: str, profile: dict | None = None) -> int:
    """Create a restaurant owned by ``account_id`` and seed its profile.

    Writes the control-plane registry row + owner membership, then the private
    profile in tt_app under RLS. Returns the new restaurant (tenant) id.
    """
    profile = dict(profile or {})
    profile.setdefault("name", name)

    with get_control_connection() as cc:
        with cc.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "INSERT INTO restaurants (name, status, logo_url)"
                " VALUES (%s, 'provisioning', %s) RETURNING id",
                (name, profile.get("logo_url")),
            )
            restaurant_id = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO memberships (account_id, restaurant_id, role)"
                " VALUES (%s, %s, 'owner')",
                (account_id, restaurant_id),
            )
        cc.commit()
        audit.record(
            cc, "restaurant_provisioned",
            account_id=account_id, restaurant_id=restaurant_id, detail={"name": name},
        )

    with app_connection(restaurant_id) as ac:
        repo.upsert_profile(ac, restaurant_id, profile)

    return restaurant_id


def set_restaurant_name(restaurant_id: int, name: str) -> None:
    """Keep the denormalized control-plane name in sync with the profile."""
    with get_control_connection() as cc, cc.cursor() as cur:
        cur.execute("UPDATE restaurants SET name = %s WHERE id = %s", (name, restaurant_id))
        cc.commit()


def set_restaurant_logo(restaurant_id: int, logo_url: str | None) -> None:
    """Keep the denormalized control-plane logo in sync with the profile."""
    with get_control_connection() as cc, cc.cursor() as cur:
        cur.execute("UPDATE restaurants SET logo_url = %s WHERE id = %s",
                    (logo_url or None, restaurant_id))
        cc.commit()


def backfill_restaurant_logos() -> None:
    """One-time-ish: fill control-plane logo_url from the tenant profile for
    locales created before the column existed. Skips ones already set."""
    with get_control_connection() as cc, cc.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id FROM restaurants WHERE logo_url IS NULL AND status <> 'deleted'")
        ids = [r["id"] for r in cur.fetchall()]
    for rid in ids:
        try:
            with app_connection(rid) as ac:
                profile = repo.get_profile(ac, rid) or {}
            logo = profile.get("logo_url")
            if logo:
                set_restaurant_logo(rid, logo)
        except Exception:  # noqa: BLE001 — a single bad tenant shouldn't abort the sweep
            continue
