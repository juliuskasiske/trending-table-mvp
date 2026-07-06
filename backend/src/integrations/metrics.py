"""Post metrics from Instagram.

Real fetching uses the creator's connected Instagram token (Meta "Instagram API
with Instagram Login") to read a post's live insights. When Instagram isn't
configured (local/dev), ``fetch_cumulative_metrics`` falls back to a
deterministic MOCK that grows views over time so the metering pipeline + poller
can be exercised end-to-end. The shape returned is identical either way.

TikTok/YouTube fetching isn't wired yet — those posts skip (return None) once a
real API is configured, and use the mock in dev.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import instagram


def real_apis_configured() -> bool:
    return instagram.enabled()


def fetch_cumulative_metrics(post: dict, ig_token: str | None = None) -> dict | None:
    """Cumulative metrics for one post.

    - Instagram post with a connected token + resolved media id → live insights.
    - No real API configured (dev) → a growing mock, for any platform.
    - Real API configured but this post can't be fetched (not connected, non-IG,
      or an API error) → None, so the poller skips it rather than billing on
      fabricated numbers.
    """
    if (
        post.get("platform") == "instagram"
        and ig_token
        and post.get("platform_post_id")
        and instagram.enabled()
    ):
        snapshot = _instagram_snapshot(ig_token, post)
        if snapshot is not None:
            return snapshot

    if instagram.enabled():
        return None  # real API configured but unresolved — don't mock-bill
    return _mock_snapshot(post)


def _instagram_snapshot(token: str, post: dict) -> dict | None:
    """Live counts for one Instagram media. Reels expose 'views'; other media
    fall back to 'reach'. Likes/comments come from the media object itself."""
    media_id = str(post["platform_post_id"])
    try:
        insights = instagram.media_insights(token, media_id, post.get("media_product_type"))
        media = instagram.media_by_id(token, media_id)
    except Exception:
        return None
    views = insights.get("views") or insights.get("reach") or 0
    reach = insights.get("reach")
    return {
        "views": int(views or 0),
        "likes": int(media.get("like_count") or 0),
        "comments": int(media.get("comments_count") or 0),
        "shares": None,
        "saves": None,
        "reach": int(reach) if reach is not None else None,
        "impressions": None,
        "source": {"ig": True, "media_id": media_id, "insights": insights},
    }


def _mock_snapshot(post: dict) -> dict:
    """Deterministic dev mock: ~600 views/hour since the post went live."""
    posted = post.get("posted_at") or post.get("created_at")
    if isinstance(posted, datetime):
        hours = max(0.0, (datetime.now(timezone.utc) - posted).total_seconds() / 3600)
    else:
        hours = 1.0
    views = int(600 * hours) + 50
    return {
        "views": views,
        "likes": int(views * 0.08),
        "comments": int(views * 0.01),
        "shares": int(views * 0.02),
        "saves": int(views * 0.03),
        "reach": int(views * 0.9),
        "impressions": views,
        "source": {"mock": True, "platform": post.get("platform")},
    }
