"""Metrics poller: for each live post, fetch metrics and bill new views.

Run one pass:  python -m src.workers.metrics_poller
Schedule it (cron / APScheduler) in production. Not auto-started by the API so
dev runs don't accrue mock charges unexpectedly.
"""
from __future__ import annotations

from psycopg.rows import dict_row

from ..billing import metering
from ..db.connection import get_control_connection
from ..integrations import metrics as metrics_client


def poll_once() -> list[dict]:
    """Poll every live post once; returns per-post billing results."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, platform, restaurant_id, creator_id, posted_at, created_at, billed_views"
            " FROM posts WHERE status = 'live'"
        )
        posts = cur.fetchall()

    results = []
    for post in posts:
        try:
            snapshot = metrics_client.fetch_cumulative_metrics(post)
            billed = metering.ingest_metrics(post["id"], snapshot)
            results.append({"post_id": post["id"], **billed})
        except Exception as exc:  # keep polling the rest
            results.append({"post_id": post["id"], "error": str(exc)})
    return results


if __name__ == "__main__":
    for r in poll_once():
        print(r)
