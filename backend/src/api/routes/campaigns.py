"""Restaurant-side marketplace routes: book creators (campaigns), list them."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from ... import audit
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api/restaurants", tags=["campaigns"])


class CampaignIn(BaseModel):
    creator_id: int
    agreed_rate_eur: float | None = None


@router.post("/{restaurant_id}/campaigns")
def create_campaign(body: CampaignIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT id FROM creators WHERE id = %s", (body.creator_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Creator not found.")
            cur.execute(
                "INSERT INTO campaigns (restaurant_id, creator_id, status, agreed_rate_eur)"
                " VALUES (%s, %s, 'accepted', %s)"
                " RETURNING id, restaurant_id, creator_id, status, agreed_rate_eur, created_at",
                (rid, body.creator_id, body.agreed_rate_eur),
            )
            campaign = cur.fetchone()
        conn.commit()
        audit.record(conn, "campaign_created", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"creator_id": body.creator_id})
    return campaign


@router.get("/{restaurant_id}/campaigns")
def list_campaigns(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.creator_id, cr.display_name AS creator_name, cr.email AS creator_email,"
            "   c.status, c.agreed_rate_eur, c.created_at"
            " FROM campaigns c JOIN creators cr ON cr.id = c.creator_id"
            " WHERE c.restaurant_id = %s ORDER BY c.created_at DESC",
            (rid,),
        )
        return {"campaigns": cur.fetchall()}
