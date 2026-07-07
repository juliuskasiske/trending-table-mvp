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
_STATUSES = ("active", "cancelled")
_REASONS = ("social_presence", "closing", "no_need", "sub_cost",
            "usage_cost", "low_control", "other")
# Fields a generic PATCH may touch (dates, status, cancel reason). Stage changes
# go through the dedicated /stage endpoint so they get logged. Names are fixed
# here, never from the client, so interpolating them is safe.
_PATCHABLE = ("outreach_date", "planned_l3", "planned_l5", "status", "cancel_reason", "comment")
_COLS = ("id, place_id, name, address, outreach_date, stage, planned_l3, planned_l5,"
         " status, cancel_reason, comment, created_at")
# The lead columns plus the timestamped stage-transition log, oldest first.
_LEAD_WITH_EVENTS = (
    f"SELECT {_COLS},"
    "   COALESCE((SELECT json_agg(json_build_object('stage', e.stage,"
    "       'changed_at', e.changed_at) ORDER BY e.changed_at)"
    "     FROM lead_stage_events e WHERE e.lead_id = outreach_leads.id), '[]') AS events"
    " FROM outreach_leads"
)


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
        cur.execute(f"{_LEAD_WITH_EVENTS} ORDER BY created_at DESC")
        return {"leads": cur.fetchall()}


@router.post("/leads")
def create_lead(body: LeadIn, _: None = Depends(deps.require_admin)) -> dict:
    """Create a lead (from a Google pick or a manual name/address) at stage L1,
    logging the L1 entry so progression has a start date."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO outreach_leads (place_id, name, address) VALUES (%s, %s, %s) RETURNING id",
            (body.place_id, name, body.address or None),
        )
        lead_id = cur.fetchone()["id"]
        cur.execute("INSERT INTO lead_stage_events (lead_id, stage) VALUES (%s, 'l1')", (lead_id,))
        cur.execute(f"{_LEAD_WITH_EVENTS} WHERE id = %s", (lead_id,))
        lead = cur.fetchone()
        conn.commit()
    return lead


class LeadPatch(BaseModel):
    outreach_date: str | None = None
    planned_l3: str | None = None
    planned_l5: str | None = None
    status: str | None = None
    cancel_reason: str | None = None
    comment: str | None = None


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: int, body: LeadPatch, _: None = Depends(deps.require_admin)) -> dict:
    # Only the fields actually sent are touched; an explicit "" clears a date.
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in _PATCHABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")
    if "status" in fields and fields["status"] not in _STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    if "cancel_reason" in fields and fields["cancel_reason"] not in ("", None, *_REASONS):
        raise HTTPException(status_code=400, detail="Invalid cancel reason.")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = [(None if v == "" else v) for v in fields.values()]  # "" → NULL, keep e.g. "0"
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"UPDATE outreach_leads SET {set_clause}, updated_at = NOW() WHERE id = %s"
            f" RETURNING {_COLS}",
            (*values, lead_id),
        )
        lead = cur.fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found.")
        conn.commit()
    return lead


class StageIn(BaseModel):
    stage: str


@router.post("/leads/{lead_id}/stage")
def set_stage(lead_id: int, body: StageIn, _: None = Depends(deps.require_admin)) -> dict:
    """Move a lead to a stage AND log the transition (this is the only place a
    stage changes — so the timestamp becomes the lead's actual date for it)."""
    if body.stage not in _STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage.")
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "UPDATE outreach_leads SET stage = %s, updated_at = NOW() WHERE id = %s RETURNING id",
            (body.stage, lead_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Lead not found.")
        cur.execute(
            "INSERT INTO lead_stage_events (lead_id, stage) VALUES (%s, %s)",
            (lead_id, body.stage),
        )
        cur.execute(f"{_LEAD_WITH_EVENTS} WHERE id = %s", (lead_id,))
        lead = cur.fetchone()
        conn.commit()
    return lead


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: int, _: None = Depends(deps.require_admin)) -> dict:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM outreach_leads WHERE id = %s", (lead_id,))
        conn.commit()
    return {"ok": True}
