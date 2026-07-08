"""Creator-side routes: profile, social handles + Instagram connect, campaigns, posts."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ... import audit, config, crypto
from ...db.connection import get_control_connection
from ...integrations import instagram

_log = logging.getLogger("creator")
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


class HandlesIn(BaseModel):
    instagram: str | None = None
    tiktok: str | None = None
    youtube: str | None = None


class PostIn(BaseModel):
    campaign_id: int
    url: str
    caption: str | None = None


def _clean_handle(h: str | None) -> str | None:
    h = (h or "").strip().lstrip("@")
    return h or None


def _sign_state(creator_id: int) -> str:
    """A tamper-proof state that binds the OAuth round-trip to one creator,
    so the callback trusts it even without the session cookie."""
    sig = hmac.new(config.SESSION_SECRET.encode(), str(creator_id).encode(), hashlib.sha256).hexdigest()[:32]
    return f"{creator_id}.{sig}"


def _verify_state(state: str | None) -> int | None:
    try:
        cid, sig = (state or "").split(".", 1)
        expected = hmac.new(config.SESSION_SECRET.encode(), cid.encode(), hashlib.sha256).hexdigest()[:32]
        return int(cid) if hmac.compare_digest(sig, expected) else None
    except Exception:
        return None


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


@router.post("/handles")
def set_handles(body: HandlesIn, principal: dict = Depends(deps.require_creator)) -> dict:
    """Capture the creator's social handles early in onboarding. At least one of
    Instagram / TikTok / YouTube is required. Handles are stored 'pending' until
    the platform is actually connected (Instagram is connected via OAuth)."""
    handles = {p: _clean_handle(getattr(body, p)) for p in ("instagram", "tiktok", "youtube")}
    handles = {p: h for p, h in handles.items() if h}
    if not handles:
        raise HTTPException(status_code=400, detail="Enter at least one handle (Instagram, TikTok, or YouTube).")
    with get_control_connection() as conn, conn.cursor() as cur:
        for platform, handle in handles.items():
            # New rows start 'pending'; existing rows keep their status (a
            # connected account stays connected, we just refresh the handle).
            cur.execute(
                "INSERT INTO social_accounts (creator_id, platform, handle, status)"
                " VALUES (%s, %s, %s, 'pending')"
                " ON CONFLICT (creator_id, platform) DO UPDATE SET handle = EXCLUDED.handle",
                (principal["id"], platform, handle),
            )
        conn.commit()
    return {"ok": True, "handles": handles}


@router.get("/handles")
def get_handles(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT platform, handle, follower_count, status FROM social_accounts"
            " WHERE creator_id = %s ORDER BY platform",
            (principal["id"],),
        )
        return {"accounts": cur.fetchall(), "instagramEnabled": instagram.enabled()}


@router.get("/instagram/connect")
def instagram_connect(principal: dict = Depends(deps.require_creator)) -> dict:
    """Return the Instagram authorization URL for the frontend to navigate to."""
    if not instagram.enabled():
        raise HTTPException(status_code=501, detail="Instagram is not configured on the server.")
    return {"url": instagram.authorize_url(_sign_state(principal["id"]))}


@router.get("/instagram/callback")
def instagram_callback(code: str | None = None, state: str | None = None,
                       error: str | None = None, error_description: str | None = None):
    """Where Instagram redirects the creator after they authorize. Exchanges the
    code for a long-lived token, stores the connection, and bounces back to the
    creator flow. Identity comes from the signed state, not the session."""
    front = config.APP_BASE_URL.rstrip("/")
    creator_id = _verify_state(state)
    if error or not code or not creator_id:
        return RedirectResponse(f"{front}/creator?ig=error")
    try:
        short = instagram.exchange_code(code)
        long = instagram.long_lived_token(short["access_token"])
        token = long.get("access_token") or short["access_token"]
        expires_in = long.get("expires_in")
        prof = instagram.profile(token)
    except Exception:
        _log.exception("Instagram OAuth failed")
        return RedirectResponse(f"{front}/creator?ig=error")

    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))) if expires_in else None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO social_accounts (creator_id, platform, handle, platform_user_id,"
            "   follower_count, access_token_enc, token_expires_at, scopes, status)"
            " VALUES (%s, 'instagram', %s, %s, %s, %s, %s, %s, 'connected')"
            " ON CONFLICT (creator_id, platform) DO UPDATE SET handle = EXCLUDED.handle,"
            "   platform_user_id = EXCLUDED.platform_user_id, follower_count = EXCLUDED.follower_count,"
            "   access_token_enc = EXCLUDED.access_token_enc, token_expires_at = EXCLUDED.token_expires_at,"
            "   scopes = EXCLUDED.scopes, status = 'connected', connected_at = NOW()",
            (creator_id, prof.get("username"), str(prof.get("user_id") or ""),
             prof.get("followers_count"), crypto.encrypt(token), expires_at,
             instagram.SCOPES.split(",")),
        )
        audit.record(conn, "instagram_connected", creator_id=creator_id,
                     detail={"username": prof.get("username")})
        conn.commit()
    return RedirectResponse(f"{front}/creator?ig=connected")


@router.get("/campaigns")
def my_campaigns(principal: dict = Depends(deps.require_creator)) -> dict:
    """Campaign assignments for this creator: brief, deadline, payout, status."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT cc.id AS assignment_id, cc.status, cc.creator_payout_eur,"
            "   cc.contacted_at, cc.posted_at, cc.approved_at,"
            "   c.id AS campaign_id, c.title, c.guidelines, c.content_deadline,"
            "   r.name AS restaurant_name,"
            "   (SELECT count(*) FROM posts p WHERE p.campaign_creator_id = cc.id) AS post_count"
            " FROM campaign_creators cc"
            "   JOIN campaigns c ON c.id = cc.campaign_id"
            "   JOIN restaurants r ON r.id = c.restaurant_id"
            " WHERE cc.creator_id = %s AND cc.status <> 'cancelled'"
            " ORDER BY cc.contacted_at DESC",
            (principal["id"],),
        )
        return {"assignments": cur.fetchall()}


def _parse_ig_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("+0000", "+00:00"))
    except Exception:
        return None


def _resolve_ig_media(conn, creator_id: int, permalink: str) -> dict | None:
    """Best-effort: use the creator's connected Instagram token to fetch the
    post's media (thumbnail, type, caption, counts). None if not resolvable."""
    if not instagram.enabled():
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT access_token_enc FROM social_accounts"
            " WHERE creator_id = %s AND platform = 'instagram' AND status = 'connected'",
            (creator_id,),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    try:
        token = crypto.decrypt(row[0])
        media = instagram.media_by_permalink(token, permalink)
        if not media:
            return None
        ins = instagram.media_insights(token, media["id"], media.get("media_product_type"))
        media["_views"] = ins.get("views") or ins.get("reach") or 0
        media["_token"] = token
        return media
    except Exception:
        _log.exception("Instagram media resolve failed")
        return None


@router.post("/posts")
def submit_post(body: PostIn, principal: dict = Depends(deps.require_creator)) -> dict:
    try:
        platform, platform_post_id = _parse_post_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    with get_control_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT cc.id AS cc_id, c.restaurant_id"
                " FROM campaign_creators cc JOIN campaigns c ON c.id = cc.campaign_id"
                " WHERE cc.campaign_id = %s AND cc.creator_id = %s"
                "   AND cc.status NOT IN ('declined', 'cancelled')",
                (body.campaign_id, principal["id"]),
            )
            assignment = cur.fetchone()
            if not assignment:
                raise HTTPException(status_code=404, detail="You are not assigned to this campaign.")

            media = _resolve_ig_media(conn, principal["id"], body.url) if platform == "instagram" else None
            # Prefer the real API media id + fetched fields when we have them.
            pid = str(media["id"]) if media else platform_post_id
            caption = (media or {}).get("caption") or body.caption
            posted_at = _parse_ig_ts((media or {}).get("timestamp"))

            cur.execute(
                "INSERT INTO posts (campaign_id, campaign_creator_id, restaurant_id, creator_id, platform,"
                "   platform_post_id, permalink, caption, thumbnail_url, media_type,"
                "   media_product_type, status, posted_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'live', COALESCE(%s, NOW()))"
                " ON CONFLICT (platform, platform_post_id) DO UPDATE SET permalink = EXCLUDED.permalink,"
                "   caption = EXCLUDED.caption, thumbnail_url = EXCLUDED.thumbnail_url,"
                "   media_type = EXCLUDED.media_type, media_product_type = EXCLUDED.media_product_type,"
                "   campaign_creator_id = EXCLUDED.campaign_creator_id"
                " RETURNING id, platform, platform_post_id, permalink, thumbnail_url, media_type, status",
                (body.campaign_id, assignment["cc_id"], assignment["restaurant_id"], principal["id"],
                 platform, pid, body.url, caption,
                 (media or {}).get("thumbnail_url") or (media or {}).get("media_url"),
                 (media or {}).get("media_type"), (media or {}).get("media_product_type"), posted_at),
            )
            post = cur.fetchone()
            if media:  # seed an initial metric snapshot from the API
                cur.execute(
                    "INSERT INTO post_metrics (post_id, views, likes, comments)"
                    " VALUES (%s, %s, %s, %s)",
                    (post["id"], media.get("_views"), media.get("like_count"), media.get("comments_count")),
                )
            # First submission moves the assignment from contacted -> posted.
            cur.execute(
                "UPDATE campaign_creators SET status = 'posted', posted_at = COALESCE(posted_at, NOW())"
                " WHERE id = %s AND status = 'contacted'",
                (assignment["cc_id"],),
            )
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
