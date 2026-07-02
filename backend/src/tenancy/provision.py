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
                "INSERT INTO restaurants (name, status) VALUES (%s, 'provisioning') RETURNING id",
                (name,),
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
