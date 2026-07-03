"""Menu digitization — auth-only (not tied to a restaurant; just bytes → items).
The resulting items are saved per-restaurant via PUT /api/restaurants/{id}/menu."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import deps
from ..ratelimit import rate_limit
from ...integrations import digitize

log = logging.getLogger("trending_table.menu")
router = APIRouter(prefix="/api/menu", tags=["menu"])


class DigitizeIn(BaseModel):
    data: str | None = None
    url: str | None = None
    mode: Literal["fast", "ai"] = "fast"


@router.post("/digitize", dependencies=[Depends(rate_limit("digitize", 20, 60))])
def digitize_menu(body: DigitizeIn, _principal: dict = Depends(deps.current_principal)) -> dict:
    if not body.data and not body.url:
        raise HTTPException(status_code=400, detail="Provide a PDF (data) or a url.")
    try:
        items, source = digitize.digitize(data=body.data, url=body.url, mode=body.mode)
    except Exception:
        log.exception("menu digitize failed")  # detail stays server-side
        raise HTTPException(status_code=502, detail="Couldn't read that menu. Check the link, or upload a PDF.")
    return {"items": items, "count": len(items), "source": source}
