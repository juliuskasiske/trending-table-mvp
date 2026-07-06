"""Creator discovery for restaurants: browse the directory, view a creator's
profile, and rate a creator after a completed collaboration.

Read routes are account-authenticated (any logged-in restaurant account may
browse). Reviewing is restaurant-scoped and gated on a completed campaign.
Inviting a creator reuses POST /api/restaurants/{id}/campaigns (status
'proposed'); see campaigns.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from ... import audit
from ...db.connection import get_control_connection
from .. import deps
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api", tags=["creators"])

# A creator shows up in the directory once they've onboarded — i.e. entered at
# least one social handle (a row in social_accounts).
_ONBOARDED = "EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.creator_id = c.id)"


@router.get("/creators")
def list_creators(
    principal: dict = Depends(deps.require_account),
    q: str | None = None,
    platform: str | None = None,
    category: str | None = None,
) -> dict:
    """The creator directory: onboarded creators with profile, socials and the
    aggregated star rating. Optional text / platform / category filters."""
    where = ["c.status = 'active'", _ONBOARDED]
    params: list = []
    if q:
        where.append(
            "(c.display_name ILIKE %s OR EXISTS (SELECT 1 FROM social_accounts sa"
            "   WHERE sa.creator_id = c.id AND sa.handle ILIKE %s))"
        )
        params += [f"%{q}%", f"%{q}%"]
    if platform in ("instagram", "tiktok", "youtube"):
        where.append(
            "EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.creator_id = c.id"
            "   AND sa.platform = %s)"
        )
        params.append(platform)
    if category:
        where.append("%s = ANY(cp.categories)")
        params.append(category)

    sql = (
        "SELECT c.id, c.display_name, cp.city, cp.avatar_url,"
        "   COALESCE(cp.categories, '{}') AS categories, cp.base_rate_eur,"
        "   COALESCE((SELECT SUM(follower_count) FROM social_accounts sa"
        "       WHERE sa.creator_id = c.id), 0) AS follower_total,"
        "   (SELECT json_agg(json_build_object('platform', sa.platform,"
        "       'handle', sa.handle, 'follower_count', sa.follower_count)"
        "       ORDER BY sa.platform) FROM social_accounts sa WHERE sa.creator_id = c.id) AS socials,"
        "   (SELECT ROUND(AVG(rating)::numeric, 1) FROM creator_reviews r WHERE r.creator_id = c.id) AS rating_avg,"
        "   (SELECT count(*) FROM creator_reviews r WHERE r.creator_id = c.id) AS rating_count"
        " FROM creators c LEFT JOIN creator_profiles cp ON cp.creator_id = c.id"
        " WHERE " + " AND ".join(where) +
        " ORDER BY follower_total DESC, c.display_name ASC NULLS LAST LIMIT 200"
    )
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return {"creators": cur.fetchall()}


@router.get("/creators/{creator_id}")
def creator_detail(
    creator_id: int,
    principal: dict = Depends(deps.require_account),
    restaurant_id: int | None = None,
) -> dict:
    """A creator's full profile + socials + rating + recent reviews. When a
    restaurant_id the caller belongs to is passed, also returns this
    restaurant's own review, whether it may review (a completed campaign
    exists), and whether it has already invited the creator."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.display_name, cp.bio, cp.city,"
            "   COALESCE(cp.categories, '{}') AS categories,"
            "   COALESCE(cp.languages, '{}') AS languages, cp.avatar_url, cp.base_rate_eur"
            " FROM creators c LEFT JOIN creator_profiles cp ON cp.creator_id = c.id"
            " WHERE c.id = %s AND c.status = 'active'",
            (creator_id,),
        )
        creator = cur.fetchone()
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found.")

        cur.execute(
            "SELECT platform, handle, follower_count, status FROM social_accounts"
            " WHERE creator_id = %s ORDER BY platform",
            (creator_id,),
        )
        socials = cur.fetchall()

        cur.execute(
            "SELECT ROUND(AVG(rating)::numeric, 1) AS avg, count(*) AS n"
            " FROM creator_reviews WHERE creator_id = %s",
            (creator_id,),
        )
        agg = cur.fetchone()

        cur.execute(
            "SELECT r.rating, r.comment, r.created_at, rest.name AS restaurant_name"
            " FROM creator_reviews r JOIN restaurants rest ON rest.id = r.restaurant_id"
            " WHERE r.creator_id = %s ORDER BY r.created_at DESC LIMIT 20",
            (creator_id,),
        )
        reviews = cur.fetchall()

        my_review = None
        can_review = False
        already_invited = False
        if restaurant_id is not None:
            deps.assert_membership(principal["id"], restaurant_id)  # 403 if not a member
            cur.execute(
                "SELECT rating, comment FROM creator_reviews"
                " WHERE restaurant_id = %s AND creator_id = %s",
                (restaurant_id, creator_id),
            )
            my_review = cur.fetchone()
            cur.execute(
                "SELECT"
                "   EXISTS (SELECT 1 FROM campaigns WHERE restaurant_id = %s AND creator_id = %s"
                "       AND status = 'completed') AS can_review,"
                "   EXISTS (SELECT 1 FROM campaigns WHERE restaurant_id = %s AND creator_id = %s"
                "       AND status <> 'cancelled') AS invited",
                (restaurant_id, creator_id, restaurant_id, creator_id),
            )
            flags = cur.fetchone()
            can_review, already_invited = flags["can_review"], flags["invited"]

    return {
        "creator": creator,
        "socials": socials,
        "rating_avg": agg["avg"],
        "rating_count": agg["n"],
        "reviews": reviews,
        "my_review": my_review,
        "can_review": can_review,
        "already_invited": already_invited,
    }


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


@router.post("/restaurants/{restaurant_id}/creators/{creator_id}/review")
def review_creator(creator_id: int, body: ReviewIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Rate a creator. Allowed only once the restaurant has a completed
    collaboration with them; re-submitting updates the existing review."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id FROM campaigns WHERE restaurant_id = %s AND creator_id = %s"
            " AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
            (rid, creator_id),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(
                status_code=403,
                detail="You can review a creator only after a completed collaboration.",
            )
        cur.execute(
            "INSERT INTO creator_reviews (creator_id, restaurant_id, campaign_id, rating, comment)"
            " VALUES (%s, %s, %s, %s, %s)"
            " ON CONFLICT (restaurant_id, creator_id)"
            "   DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()"
            " RETURNING id, rating, comment",
            (creator_id, rid, campaign["id"], body.rating, body.comment),
        )
        review = cur.fetchone()
        conn.commit()
        audit.record(conn, "creator_reviewed", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"creator_id": creator_id, "rating": body.rating})
    return review
