"""Google Places API (New) proxy — keeps the API key server-side."""
from __future__ import annotations

import os

import httpx

BASE = "https://places.googleapis.com/v1"

_IGNORE_TYPES = {"point_of_interest", "establishment", "food", "restaurant"}


def _key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "")


def enabled() -> bool:
    return bool(_key())


def classify(types: list[str] | None) -> tuple[str, list[str]]:
    """Map Google `types` to a friendly primary category + tag list."""
    tags: list[str] = []
    for t in types or []:
        if t in _IGNORE_TYPES:
            continue
        pretty = t.replace("_", " ").replace("restaurant", "").strip().capitalize()
        if pretty:
            tags.append(pretty)
    return (tags[0] if tags else "Restaurant"), tags[:4]


def search(query: str) -> list[dict]:
    if not enabled() or len(query.strip()) < 2:
        return []
    r = httpx.post(
        f"{BASE}/places:searchText",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": _key(),
            "X-Goog-FieldMask": ",".join([
                "places.id", "places.displayName", "places.formattedAddress",
                "places.rating", "places.userRatingCount",
                "places.primaryTypeDisplayName", "places.primaryType",
            ]),
        },
        json={"textQuery": query, "includedType": "restaurant", "maxResultCount": 5},
        timeout=15,
    )
    r.raise_for_status()
    out = []
    for p in r.json().get("places", []):
        out.append({
            "placeId": p.get("id"),
            "name": (p.get("displayName") or {}).get("text", ""),
            "address": p.get("formattedAddress", ""),
            "rating": p.get("rating"),
            "reviews": p.get("userRatingCount"),
            "primaryType": (p.get("primaryTypeDisplayName") or {}).get("text")
            or p.get("primaryType", ""),
        })
    return out


def _city_from(components: list | None) -> str:
    """Pull the city out of Google's structured address components (locality,
    with sensible fallbacks) — no address-string parsing / LLM needed."""
    by_type: dict[str, str] = {}
    for comp in components or []:
        text = comp.get("longText") or comp.get("shortText") or ""
        for typ in comp.get("types", []):
            by_type.setdefault(typ, text)
    for key in ("locality", "postal_town", "administrative_area_level_3",
                "administrative_area_level_2"):
        if by_type.get(key):
            return by_type[key]
    return ""


def details(place_id: str) -> dict:
    r = httpx.get(
        f"{BASE}/places/{place_id}",
        headers={
            "X-Goog-Api-Key": _key(),
            "X-Goog-FieldMask": ",".join([
                "id", "displayName", "formattedAddress", "addressComponents",
                "rating", "userRatingCount",
                "types", "primaryTypeDisplayName", "editorialSummary", "websiteUri",
                "priceLevel", "photos",
            ]),
        },
        timeout=15,
    )
    r.raise_for_status()
    p = r.json()
    category, tags = classify(p.get("types"))
    return {
        "placeId": p.get("id"),
        "name": (p.get("displayName") or {}).get("text", ""),
        "address": p.get("formattedAddress", ""),
        "city": _city_from(p.get("addressComponents")),
        "rating": p.get("rating"),
        "reviews": p.get("userRatingCount"),
        "category": (p.get("primaryTypeDisplayName") or {}).get("text") or category,
        "tags": tags,
        "description": (p.get("editorialSummary") or {}).get("text", ""),
        "website": p.get("websiteUri", ""),
        "priceLevel": p.get("priceLevel", ""),
        "photoName": (p.get("photos") or [{}])[0].get("name", ""),
    }


def photo(photo_name: str, max_width: int = 320) -> tuple[str, bytes]:
    """Return (content_type, bytes) for a place photo, key kept server-side."""
    width = max(1, min(max_width, 1200))
    r = httpx.get(
        f"{BASE}/{photo_name}/media",
        params={"maxWidthPx": width, "key": _key()},
        follow_redirects=True,
        timeout=20,
    )
    r.raise_for_status()
    return r.headers.get("content-type", "image/jpeg"), r.content
