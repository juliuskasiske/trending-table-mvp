"""Restaurant routes: provisioning + profile / menu / guidelines (RLS-scoped)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ...db.connection import app_connection, get_control_connection
from ...tenancy import provision, repo

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


def restaurant_ctx(restaurant_id: int, principal: dict = Depends(deps.require_account)) -> dict:
    """Gate a restaurant route on membership; yields the tenant context."""
    role = deps.assert_membership(principal["id"], restaurant_id)
    return {"restaurant_id": restaurant_id, "account_id": principal["id"], "role": role}


@router.get("")
def list_restaurants(principal: dict = Depends(deps.require_account)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT r.id, r.name, r.status, r.spending_limit_eur, m.role"
            " FROM restaurants r JOIN memberships m ON m.restaurant_id = r.id"
            " WHERE m.account_id = %s ORDER BY r.created_at",
            (principal["id"],),
        )
        rows = cur.fetchall()
    return {"restaurants": rows}


@router.post("")
def create_restaurant(body: ProvisionIn, principal: dict = Depends(deps.require_account)) -> dict:
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
