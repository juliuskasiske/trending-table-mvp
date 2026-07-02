"""Menu digitization — auth-only (not tied to a restaurant; just bytes → items).
The resulting items are saved per-restaurant via PUT /api/restaurants/{id}/menu."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import deps
from ...integrations import digitize

router = APIRouter(prefix="/api/menu", tags=["menu"])


class DigitizeIn(BaseModel):
    data: str | None = None
    url: str | None = None
    mode: Literal["fast", "ai"] = "fast"


@router.post("/digitize")
def digitize_menu(body: DigitizeIn, _principal: dict = Depends(deps.current_principal)) -> dict:
    if not body.data and not body.url:
        raise HTTPException(status_code=400, detail="Provide a PDF (data) or a url.")
    try:
        items, source = digitize.digitize(data=body.data, url=body.url, mode=body.mode)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Couldn't digitize this menu: {exc}")
    return {"items": items, "count": len(items), "source": source}
