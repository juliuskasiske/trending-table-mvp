"""Direct messaging between a restaurant and a creator.

Two mirrored surfaces over one `messages` table:
- restaurant side: /api/restaurants/{id}/messages...  (restaurant_ctx auth)
- creator side:    /api/creator/messages...           (require_creator auth)

A thread is the full history for one (restaurant, creator) pair. Opening a
thread marks the other party's messages as read for the caller's side.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from ...db.connection import get_control_connection
from .. import deps
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api", tags=["messages"])


class MessageIn(BaseModel):
    body: str


def _clean_body(body: str) -> str:
    text = (body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message can't be empty.")
    return text[:4000]


# --------------------------------------------------------------------------- #
# Restaurant side
# --------------------------------------------------------------------------- #

@router.get("/restaurants/{restaurant_id}/messages")
def restaurant_threads(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """One entry per creator this restaurant has a thread with: last message
    preview + time and the restaurant's unread count."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT t.creator_id, cr.display_name AS creator_name, cp.avatar_url AS creator_avatar,"
            "   lm.body AS last_body, lm.created_at AS last_at, lm.sender_role AS last_sender,"
            "   COALESCE(u.unread, 0) AS unread"
            " FROM (SELECT DISTINCT creator_id FROM messages WHERE restaurant_id = %s) t"
            "   JOIN creators cr ON cr.id = t.creator_id"
            "   LEFT JOIN creator_profiles cp ON cp.creator_id = t.creator_id"
            "   LEFT JOIN LATERAL (SELECT body, created_at, sender_role FROM messages"
            "       WHERE restaurant_id = %s AND creator_id = t.creator_id"
            "       ORDER BY created_at DESC LIMIT 1) lm ON true"
            "   LEFT JOIN LATERAL (SELECT count(*) AS unread FROM messages"
            "       WHERE restaurant_id = %s AND creator_id = t.creator_id"
            "       AND sender_role = 'creator' AND read_by_restaurant_at IS NULL) u ON true"
            " ORDER BY lm.created_at DESC",
            (rid, rid, rid),
        )
        return {"threads": cur.fetchall()}


@router.get("/restaurants/{restaurant_id}/messages/{creator_id}")
def restaurant_thread(creator_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Full thread with one creator; marks the creator's messages read."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.display_name AS name, cp.avatar_url AS avatar"
            " FROM creators c LEFT JOIN creator_profiles cp ON cp.creator_id = c.id"
            " WHERE c.id = %s",
            (creator_id,),
        )
        peer = cur.fetchone()
        if not peer:
            raise HTTPException(status_code=404, detail="Creator not found.")
        cur.execute(
            "UPDATE messages SET read_by_restaurant_at = NOW()"
            " WHERE restaurant_id = %s AND creator_id = %s"
            "   AND sender_role = 'creator' AND read_by_restaurant_at IS NULL",
            (rid, creator_id),
        )
        cur.execute(
            "SELECT id, sender_role, body, created_at FROM messages"
            " WHERE restaurant_id = %s AND creator_id = %s ORDER BY created_at",
            (rid, creator_id),
        )
        messages = cur.fetchall()
        conn.commit()
    return {"peer": peer, "messages": messages}


@router.post("/restaurants/{restaurant_id}/messages/{creator_id}")
def restaurant_send(creator_id: int, body: MessageIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    text = _clean_body(body.body)
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT 1 FROM creators WHERE id = %s", (creator_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Creator not found.")
        cur.execute(
            "INSERT INTO messages (restaurant_id, creator_id, sender_role, body, read_by_restaurant_at)"
            " VALUES (%s, %s, 'restaurant', %s, NOW())"
            " RETURNING id, sender_role, body, created_at",
            (rid, creator_id, text),
        )
        message = cur.fetchone()
        conn.commit()
    return message


# --------------------------------------------------------------------------- #
# Creator side
# --------------------------------------------------------------------------- #

@router.get("/creator/messages")
def creator_threads(principal: dict = Depends(deps.require_creator)) -> dict:
    """One entry per restaurant this creator has a thread with."""
    cid = principal["id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT t.restaurant_id, r.name AS restaurant_name,"
            "   lm.body AS last_body, lm.created_at AS last_at, lm.sender_role AS last_sender,"
            "   COALESCE(u.unread, 0) AS unread"
            " FROM (SELECT DISTINCT restaurant_id FROM messages WHERE creator_id = %s) t"
            "   JOIN restaurants r ON r.id = t.restaurant_id"
            "   LEFT JOIN LATERAL (SELECT body, created_at, sender_role FROM messages"
            "       WHERE creator_id = %s AND restaurant_id = t.restaurant_id"
            "       ORDER BY created_at DESC LIMIT 1) lm ON true"
            "   LEFT JOIN LATERAL (SELECT count(*) AS unread FROM messages"
            "       WHERE creator_id = %s AND restaurant_id = t.restaurant_id"
            "       AND sender_role = 'restaurant' AND read_by_creator_at IS NULL) u ON true"
            " ORDER BY lm.created_at DESC",
            (cid, cid, cid),
        )
        return {"threads": cur.fetchall()}


@router.get("/creator/messages/{restaurant_id}")
def creator_thread(restaurant_id: int, principal: dict = Depends(deps.require_creator)) -> dict:
    cid = principal["id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id, name FROM restaurants WHERE id = %s", (restaurant_id,))
        peer = cur.fetchone()
        if not peer:
            raise HTTPException(status_code=404, detail="Restaurant not found.")
        cur.execute(
            "UPDATE messages SET read_by_creator_at = NOW()"
            " WHERE restaurant_id = %s AND creator_id = %s"
            "   AND sender_role = 'restaurant' AND read_by_creator_at IS NULL",
            (restaurant_id, cid),
        )
        cur.execute(
            "SELECT id, sender_role, body, created_at FROM messages"
            " WHERE restaurant_id = %s AND creator_id = %s ORDER BY created_at",
            (restaurant_id, cid),
        )
        messages = cur.fetchall()
        conn.commit()
    return {"peer": {"id": peer["id"], "name": peer["name"], "avatar": None}, "messages": messages}


@router.post("/creator/messages/{restaurant_id}")
def creator_send(restaurant_id: int, body: MessageIn,
                 principal: dict = Depends(deps.require_creator)) -> dict:
    cid = principal["id"]
    text = _clean_body(body.body)
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT 1 FROM restaurants WHERE id = %s", (restaurant_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Restaurant not found.")
        cur.execute(
            "INSERT INTO messages (restaurant_id, creator_id, sender_role, body, read_by_creator_at)"
            " VALUES (%s, %s, 'creator', %s, NOW())"
            " RETURNING id, sender_role, body, created_at",
            (restaurant_id, cid, text),
        )
        message = cur.fetchone()
        conn.commit()
    return message
