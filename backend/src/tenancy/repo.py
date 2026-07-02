"""Data access for tt_app tables. Every function takes a tenant-scoped
connection (from ``app_connection(tenant_id)``), so RLS enforces isolation."""
from __future__ import annotations

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

PROFILE_COLS = [
    "place_id", "name", "address", "city", "category", "tags", "google_rating",
    "google_reviews", "description", "website", "logo_url", "photo_ref", "price_level",
]
_MENU_SOURCES = {"llm", "heuristic", "manual"}


# ---- profile ---------------------------------------------------------------

def upsert_profile(conn: psycopg.Connection, tenant_id: int, data: dict) -> None:
    cols = [c for c in PROFILE_COLS if c in data and data[c] is not None]
    if not cols:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO restaurant_profiles (tenant_id) VALUES (%s)"
                " ON CONFLICT (tenant_id) DO NOTHING",
                (tenant_id,),
            )
        conn.commit()
        return
    fields = ["tenant_id"] + cols
    values = [tenant_id] + [data[c] for c in cols]
    query = sql.SQL(
        "INSERT INTO restaurant_profiles ({fields}) VALUES ({ph})"
        " ON CONFLICT (tenant_id) DO UPDATE SET {sets}, updated_at = NOW()"
    ).format(
        fields=sql.SQL(", ").join(sql.Identifier(c) for c in fields),
        ph=sql.SQL(", ").join(sql.Placeholder() for _ in fields),
        sets=sql.SQL(", ").join(
            sql.SQL("{c} = EXCLUDED.{c}").format(c=sql.Identifier(c)) for c in cols
        ),
    )
    with conn.cursor() as cur:
        cur.execute(query, values)
    conn.commit()


def get_profile(conn: psycopg.Connection, tenant_id: int) -> dict | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM restaurant_profiles WHERE tenant_id = %s", (tenant_id,))
        return cur.fetchone()


# ---- menu ------------------------------------------------------------------

def list_menu(conn: psycopg.Connection, tenant_id: int) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, section, name, price, sort_order, source FROM menu_items"
            " WHERE tenant_id = %s ORDER BY sort_order, id",
            (tenant_id,),
        )
        return cur.fetchall()


def replace_menu(conn: psycopg.Connection, tenant_id: int, items: list[dict]) -> int:
    """Full-replace the menu (matches the editable-list UX)."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM menu_items WHERE tenant_id = %s", (tenant_id,))
        for i, it in enumerate(items):
            source = it.get("source", "manual")
            if source not in _MENU_SOURCES:
                source = "manual"
            cur.execute(
                "INSERT INTO menu_items (tenant_id, section, name, price, sort_order, source)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (tenant_id, it.get("section"), it.get("name", ""), it.get("price"), i, source),
            )
    conn.commit()
    return len(items)


def upsert_menu_source(conn: psycopg.Connection, tenant_id: int, kind: str | None,
                       url: str | None, engine: str | None, item_count: int | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO menu_sources (tenant_id, kind, url, engine, item_count, digitized_at)"
            " VALUES (%s, %s, %s, %s, %s, NOW())"
            " ON CONFLICT (tenant_id) DO UPDATE SET kind = EXCLUDED.kind, url = EXCLUDED.url,"
            "   engine = EXCLUDED.engine, item_count = EXCLUDED.item_count, digitized_at = NOW()",
            (tenant_id, kind, url, engine, item_count),
        )
    conn.commit()


# ---- guidelines ------------------------------------------------------------

def upsert_guidelines(conn: psycopg.Connection, tenant_id: int, data: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO content_guidelines (tenant_id, show, must_include, avoid, handle, notes)"
            " VALUES (%s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (tenant_id) DO UPDATE SET show = EXCLUDED.show,"
            "   must_include = EXCLUDED.must_include, avoid = EXCLUDED.avoid,"
            "   handle = EXCLUDED.handle, notes = EXCLUDED.notes, updated_at = NOW()",
            (
                tenant_id,
                data.get("show", []),
                data.get("must_include", []),
                data.get("avoid", []),
                data.get("handle"),
                data.get("notes"),
            ),
        )
    conn.commit()


def get_guidelines(conn: psycopg.Connection, tenant_id: int) -> dict | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM content_guidelines WHERE tenant_id = %s", (tenant_id,))
        return cur.fetchone()
