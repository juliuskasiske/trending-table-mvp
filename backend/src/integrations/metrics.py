"""Post metrics from Instagram/TikTok.

Real fetching needs approved IG (Meta) / TikTok developer apps. Until those keys
land, ``fetch_cumulative_metrics`` returns a deterministic MOCK that grows views
over time so the metering pipeline + poller can be exercised end-to-end. The
shape it returns is exactly what the real clients will produce.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone


def real_apis_configured() -> bool:
    return bool(os.environ.get("META_APP_ID") or os.environ.get("TIKTOK_CLIENT_KEY"))


def fetch_cumulative_metrics(post: dict) -> dict:
    """Return cumulative metrics for one post. Mock grows ~600 views/hour live."""
    if real_apis_configured():
        raise NotImplementedError("Real IG/TikTok metric fetch not wired yet.")
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
