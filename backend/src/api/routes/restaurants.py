"""Restaurant routes: provisioning + profile / menu / guidelines (RLS-scoped)."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends
from psycopg.rows import dict_row
from pydantic import BaseModel

from fastapi import HTTPException

from .. import deps
from ...billing import stripe_client
from ...db.connection import app_connection, get_control_connection
from ...integrations import digitize
from ...tenancy import provision, repo

_log = logging.getLogger("trending_table.restaurants")
router = APIRouter(prefix="/api/restaurants", tags=["restaurants"])


class ProvisionIn(BaseModel):
    name: str
    place_id: str | None = None
    address: str | None = None
    city: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    google_rating: float | None = None
    google_reviews: int | None = None
    description: str | None = None
    website: str | None = None
    logo_url: str | None = None
    photo_ref: str | None = None
    price_level: str | None = None


class ProfileIn(BaseModel):
    name: str | None = None
    place_id: str | None = None
    address: str | None = None
    city: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    google_rating: float | None = None
    google_reviews: int | None = None
    description: str | None = None
    website: str | None = None
    logo_url: str | None = None
    photo_ref: str | None = None
    price_level: str | None = None


class MenuItemIn(BaseModel):
    section: str | None = None
    name: str
    price: str | None = None
    source: Literal["llm", "heuristic", "manual"] = "manual"


class MenuIn(BaseModel):
    items: list[MenuItemIn]


class GuidelinesIn(BaseModel):
    show: list[str] = []
    must_include: list[str] = []
    avoid: list[str] = []
    handle: str | None = None
    notes: str | None = None


class DigitizeIn(BaseModel):
    data: str | None = None      # base64 PDF (no data: prefix)
    url: str | None = None       # menu web page
    mode: Literal["fast", "ai"] = "fast"


def restaurant_ctx(restaurant_id: int, principal: dict = Depends(deps.require_account)) -> dict:
    """Gate a restaurant route on membership; yields the tenant context."""
    role = deps.assert_membership(principal["id"], restaurant_id)
    return {"restaurant_id": restaurant_id, "account_id": principal["id"], "role": role}


@router.get("")
def list_restaurants(principal: dict = Depends(deps.require_account)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT r.id, r.name, r.status, r.spending_limit_eur,"
            " r.stripe_subscription_status, m.role"
            " FROM restaurants r JOIN memberships m ON m.restaurant_id = r.id"
            " WHERE m.account_id = %s AND r.status <> 'deleted' ORDER BY r.created_at",
            (principal["id"],),
        )
        rows = cur.fetchall()
    return {"restaurants": rows}


@router.post("")
def create_restaurant(body: ProvisionIn, principal: dict = Depends(deps.require_verified_account)) -> dict:
    profile = body.model_dump(exclude_none=True)
    profile.pop("name", None)
    restaurant_id = provision.create_restaurant(principal["id"], body.name, profile)
    return {"id": restaurant_id, "name": body.name, "status": "provisioning"}


@router.get("/{restaurant_id}")
def get_restaurant(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with app_connection(rid) as conn:
        return {"id": rid, "role": ctx["role"], "profile": repo.get_profile(conn, rid)}


@router.put("/{restaurant_id}/profile")
def put_profile(body: ProfileIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    data = body.model_dump(exclude_none=True)
    with app_connection(rid) as conn:
        repo.upsert_profile(conn, rid, data)
    if body.name:  # keep the denormalized control-plane name in sync
        provision.set_restaurant_name(rid, body.name)
    return {"ok": True}


@router.get("/{restaurant_id}/menu")
def get_menu(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with app_connection(rid) as conn:
        return {"items": repo.list_menu(conn, rid)}


@router.put("/{restaurant_id}/menu")
def put_menu(body: MenuIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with app_connection(rid) as conn:
        count = repo.replace_menu(conn, rid, [i.model_dump() for i in body.items])
    return {"ok": True, "count": count}


@router.get("/{restaurant_id}/guidelines")
def get_guidelines(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with app_connection(rid) as conn:
        return {"guidelines": repo.get_guidelines(conn, rid)}


@router.put("/{restaurant_id}/guidelines")
def put_guidelines(body: GuidelinesIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with app_connection(rid) as conn:
        repo.upsert_guidelines(conn, rid, body.model_dump())
    return {"ok": True}


@router.post("/{restaurant_id}/activate")
def activate(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Finalize onboarding — mark the restaurant active."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE restaurants SET status = 'active' WHERE id = %s", (ctx["restaurant_id"],))
        conn.commit()
    return {"ok": True, "status": "active"}


def soft_delete_restaurant(conn, restaurant_id: int) -> None:
    """Cancel this restaurant's Stripe subscriptions (platform fee + usage)
    immediately and mark it deleted. Rows are kept; status becomes 'deleted'."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT stripe_subscription_id, stripe_usage_subscription_id"
            " FROM restaurants WHERE id = %s",
            (restaurant_id,),
        )
        row = cur.fetchone()
        if row:
            stripe_client.cancel_subscription(row[0])
            stripe_client.cancel_subscription(row[1])
        cur.execute("UPDATE restaurants SET status = 'deleted' WHERE id = %s", (restaurant_id,))
    conn.commit()


@router.delete("/{restaurant_id}")
def delete_restaurant(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Soft-delete a restaurant: stop its Stripe billing and tag it deleted."""
    with get_control_connection() as conn:
        soft_delete_restaurant(conn, ctx["restaurant_id"])
    return {"ok": True, "status": "deleted"}


@router.post("/{restaurant_id}/menu/digitize")
def digitize_menu(body: DigitizeIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Digitize a PDF or menu URL into items (does not save — client PUTs /menu)."""
    if not body.data and not body.url:
        raise HTTPException(status_code=400, detail="Provide a PDF (data) or a url.")
    try:
        items, source = digitize.digitize(data=body.data, url=body.url, mode=body.mode)
    except Exception:
        _log.exception("menu digitize failed")  # detail stays server-side
        raise HTTPException(status_code=502, detail="Couldn't read that menu. Check the link, or upload a PDF.")
    return {"items": items, "count": len(items), "source": source}
