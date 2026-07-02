"""Google Places proxy routes (auth required)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from .. import deps
from ...integrations import places

router = APIRouter(prefix="/api/places", tags=["places"])


def _require_enabled() -> None:
    if not places.enabled():
        raise HTTPException(status_code=501, detail="Set GOOGLE_MAPS_API_KEY.")


@router.get("/search")
def search(q: str, _principal: dict = Depends(deps.current_principal)) -> dict:
    _require_enabled()
    return {"results": places.search(q)}


@router.get("/details")
def details(id: str, _principal: dict = Depends(deps.current_principal)) -> dict:
    _require_enabled()
    return places.details(id)


@router.get("/photo")
def photo(name: str, w: int = 320, _principal: dict = Depends(deps.current_principal)) -> Response:
    _require_enabled()
    content_type, body = places.photo(name, w)
    return Response(content=body, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"})
