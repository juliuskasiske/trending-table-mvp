"""Creator-side routes: profile, social connections, campaigns, posts."""
from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ... import audit, crypto
from ...db.connection import get_control_connection

router = APIRouter(prefix="/api/creator", tags=["creator"])


class ProfileIn(BaseModel):
    bio: str | None = None
    city: str | None = None
    categories: list[str] = []
    languages: list[str] = []
    avatar_url: str | None = None
    base_rate_eur: float | None = None


class ConnectIn(BaseModel):
    platform: str  # instagram | tiktok
    handle: str
    follower_count: int | None = None


class PostIn(BaseModel):
    campaign_id: int
    url: str
    caption: str | None = None


def _parse_post_url(url: str) -> tuple[str, str]:
    ig = re.search(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)", url)
    if ig:
        return "instagram", ig.group(1)
    tt = re.search(r"tiktok\.com/@[\w.-]+/video/(\d+)", url)
    if tt:
        return "tiktok", tt.group(1)
    raise ValueError("Unrecognized Instagram/TikTok post URL")


@router.put("/profile")
def put_profile(body: ProfileIn, principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO creator_profiles (creator_id, bio, city, categories, languages, avatar_url, base_rate_eur)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (creator_id) DO UPDATE SET bio = EXCLUDED.bio, city = EXCLUDED.city,"
            "   categories = EXCLUDED.categories, languages = EXCLUDED.languages,"
            "   avatar_url = EXCLUDED.avatar_url, base_rate_eur = EXCLUDED.base_rate_eur, updated_at = NOW()",
            (principal["id"], body.bio, body.city, body.categories, body.languages,
             body.avatar_url, body.base_rate_eur),
        )
        conn.commit()
    return {"ok": True}


@router.get("/profile")
def get_profile(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM creator_profiles WHERE creator_id = %s", (principal["id"],))
        return {"profile": cur.fetchone()}


@router.post("/social/connect")
def connect_social(body: ConnectIn, principal: dict = Depends(deps.require_creator)) -> dict:
    """Connect a social account.

    Real Instagram/TikTok OAuth needs approved developer apps (META_APP_ID /
    TIKTOK_CLIENT_KEY). Until those land, this stores a dev-mock connection so
    the marketplace + metering can be built and tested; tokens are still
    encrypted at rest exactly as the real flow will store them.
    """
    if body.platform not in ("instagram", "tiktok"):
        raise HTTPException(status_code=400, detail="platform must be instagram or tiktok")
    real_oauth = bool(os.environ.get("META_APP_ID") or os.environ.get("TIKTOK_CLIENT_KEY"))
    if real_oauth:
        raise HTTPException(status_code=501, detail="Real OAuth flow not wired yet.")
    token_enc = crypto.encrypt(f"mock-token-{principal['id']}-{body.platform}")
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO social_accounts (creator_id, platform, handle, platform_user_id,"
            " follower_count, access_token_enc, status)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'connected')"
            " ON CONFLICT (creator_id, platform) DO UPDATE SET handle = EXCLUDED.handle,"
            "   follower_count = EXCLUDED.follower_count, access_token_enc = EXCLUDED.access_token_enc,"
            "   status = 'connected', connected_at = NOW()"
            " RETURNING id, platform, handle, follower_count, status",
            (principal["id"], body.platform, body.handle, f"mock_{body.handle}",
             body.follower_count, token_enc),
        )
        row = cur.fetchone()
        conn.commit()
        audit.record(conn, "social_connected", creator_id=principal["id"],
                     detail={"platform": body.platform, "mock": True})
    return row


@router.get("/social")
def list_social(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, platform, handle, follower_count, status, connected_at"
            " FROM social_accounts WHERE creator_id = %s ORDER BY platform",
            (principal["id"],),
        )
        return {"accounts": cur.fetchall()}


@router.get("/campaigns")
def my_campaigns(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.restaurant_id, r.name AS restaurant_name, c.status,"
            "   c.agreed_rate_eur, c.created_at"
            " FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id"
            " WHERE c.creator_id = %s ORDER BY c.created_at DESC",
            (principal["id"],),
        )
        return {"campaigns": cur.fetchall()}


@router.post("/posts")
def submit_post(body: PostIn, principal: dict = Depends(deps.require_creator)) -> dict:
    try:
        platform, platform_post_id = _parse_post_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    with get_control_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT id, restaurant_id FROM campaigns WHERE id = %s AND creator_id = %s",
                (body.campaign_id, principal["id"]),
            )
            campaign = cur.fetchone()
            if not campaign:
                raise HTTPException(status_code=404, detail="Campaign not found.")
            cur.execute(
                "INSERT INTO posts (campaign_id, restaurant_id, creator_id, platform,"
                "   platform_post_id, permalink, caption, status, posted_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, 'live', NOW())"
                " ON CONFLICT (platform, platform_post_id) DO UPDATE SET permalink = EXCLUDED.permalink,"
                "   caption = EXCLUDED.caption"
                " RETURNING id, platform, platform_post_id, permalink, status, billed_views",
                (body.campaign_id, campaign["restaurant_id"], principal["id"], platform,
                 platform_post_id, body.url, body.caption),
            )
            post = cur.fetchone()
            cur.execute("UPDATE campaigns SET status = 'live' WHERE id = %s AND status IN ('proposed','accepted')",
                        (body.campaign_id,))
        conn.commit()
    return post


@router.get("/posts")
def my_posts(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT p.id, p.restaurant_id, r.name AS restaurant_name, p.platform,"
            "   p.permalink, p.status, p.billed_views, p.created_at"
            " FROM posts p JOIN restaurants r ON r.id = p.restaurant_id"
            " WHERE p.creator_id = %s ORDER BY p.created_at DESC",
            (principal["id"],),
        )
        return {"posts": cur.fetchall()}
