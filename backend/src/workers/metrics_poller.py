"""Metrics poller: for each live post, fetch metrics and bill new views.

Run one pass:  python -m src.workers.metrics_poller
In production it runs on an interval (see workers.scheduler, started by the API
when METRICS_POLL_INTERVAL_SECONDS > 0). Not auto-started in dev so mock charges
don't accrue unexpectedly.
"""
from __future__ import annotations

from psycopg.rows import dict_row

from .. import crypto
from ..billing import metering
from ..db.connection import get_control_connection
from ..integrations import instagram
from ..integrations import metrics as metrics_client


def _ig_token(conn, creator_id: int) -> str | None:
    """The creator's decrypted, connected Instagram token (or None)."""
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
        return crypto.decrypt(row[0])
    except Exception:
        return None


def poll_once() -> list[dict]:
    """Poll every live post once; returns per-post billing results."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, platform, restaurant_id, creator_id, posted_at, created_at,"
            "   billed_views, platform_post_id, media_product_type"
            " FROM posts WHERE status = 'live'"
        )
        posts = cur.fetchall()
        # Resolve Instagram tokens up front, reusing this connection.
        tokens = {
            p["id"]: _ig_token(conn, p["creator_id"])
            for p in posts if p["platform"] == "instagram"
        }

    results = []
    for post in posts:
        try:
            snapshot = metrics_client.fetch_cumulative_metrics(post, ig_token=tokens.get(post["id"]))
            if snapshot is None:
                results.append({"post_id": post["id"], "skipped": True})
                continue
            billed = metering.ingest_metrics(post["id"], snapshot)
            results.append({"post_id": post["id"], **billed})
        except Exception as exc:  # keep polling the rest
            results.append({"post_id": post["id"], "error": str(exc)})
    return results


if __name__ == "__main__":
    for r in poll_once():
        print(r)
