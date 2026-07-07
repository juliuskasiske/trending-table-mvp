"""Restaurant-outreach CRM — control-tower only (ADMIN_KEY).

Prospects are identified with Google Places (name search → pick → place_id +
address), then tracked through stage gates L1..L5 with team-set dates. All
routes are gated by ``deps.require_admin``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ...db.connection import get_control_connection
from ...integrations import places

router = APIRouter(prefix="/api/admin", tags=["crm"])

_STAGES = ("l1", "l2", "l3", "l4", "l5")
# Columns a PATCH may touch (dates + stage); names are fixed here, never from
# the client, so interpolating them into the UPDATE is safe.
_PATCHABLE = ("outreach_date", "stage", "planned_l3", "actual_l3", "actual_l1")
_COLS = ("id, place_id, name, address, outreach_date, stage,"
         " planned_l3, actual_l3, actual_l1, created_at")


@router.get("/places/search")
def places_search(q: str, _: None = Depends(deps.require_admin)) -> dict:
    """Google Places text search, admin-gated (the public proxy needs a user
    session; the control tower authenticates with the admin key instead)."""
    if not places.enabled():
        raise HTTPException(status_code=501, detail="Set GOOGLE_MAPS_API_KEY.")
    return {"results": places.search(q)}


class LeadIn(BaseModel):
    place_id: str | None = None
    name: str
    address: str | None = None


@router.get("/leads")
def list_leads(_: None = Depends(deps.require_admin)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT {_COLS} FROM outreach_leads ORDER BY created_at DESC")
        return {"leads": cur.fetchall()}


@router.post("/leads")
def create_lead(body: LeadIn, _: None = Depends(deps.require_admin)) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"INSERT INTO outreach_leads (place_id, name, address) VALUES (%s, %s, %s)"
            f" RETURNING {_COLS}",
            (body.place_id, name, body.address),
        )
        lead = cur.fetchone()
        conn.commit()
    return lead


class LeadPatch(BaseModel):
    outreach_date: str | None = None
    stage: str | None = None
    planned_l3: str | None = None
    actual_l3: str | None = None
    actual_l1: str | None = None


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: int, body: LeadPatch, _: None = Depends(deps.require_admin)) -> dict:
    # Only the fields actually sent are touched; an explicit "" clears a date.
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in _PATCHABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")
    if "stage" in fields and fields["stage"] not in _STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage.")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = [(v or None) for v in fields.values()]  # "" → NULL
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"UPDATE outreach_leads SET {set_clause}, updated_at = NOW()"
            f" WHERE id = %s RETURNING {_COLS}",
            (*values, lead_id),
        )
        lead = cur.fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found.")
        conn.commit()
    return lead


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: int, _: None = Depends(deps.require_admin)) -> dict:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM outreach_leads WHERE id = %s", (lead_id,))
        conn.commit()
    return {"ok": True}
