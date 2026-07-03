"""Menu digitization: MarkItDown (PDF/HTML → markdown) + gpt-oss-120b or a fast
heuristic. Same behaviour as the retired Node service, now native Python."""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
import socket
import tempfile
from urllib.parse import urlsplit

import httpx
from markitdown import MarkItDown

_PRICE_RE = re.compile(
    r"^(?P<name>.*\S)\s+(?P<price>(?:€|EUR|£|\$)?\s?\d{1,4}(?:[.,]\d{2})?\s?(?:€|EUR)?)\s*$"
)


def markitdown_available() -> bool:
    return True  # the import above would have failed otherwise


def llm_enabled() -> bool:
    return bool(os.environ.get("LLM_BASE_URL") and os.environ.get("LLM_API_KEY"))


def _md() -> MarkItDown:
    return MarkItDown()


def pdf_to_markdown(base64_pdf: str) -> str:
    raw = base64.b64decode(base64_pdf)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(raw)
        f.flush()
        return _md().convert(f.name).text_content


_MAX_MENU_BYTES = 5 * 1024 * 1024  # 5 MB — menus are pages, not archives
_MAX_REDIRECTS = 5


def _assert_public_host(url: str) -> None:
    """SSRF guard: the URL must resolve to public addresses only.

    Users paste menu URLs and the SERVER fetches them, so without this a user
    could point us at internal targets (localhost, the Docker network, cloud
    metadata at 169.254.169.254, …).
    """
    host = urlsplit(url).hostname
    if not host:
        raise ValueError("Invalid URL")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ValueError("Could not resolve that host")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("That URL points at a non-public address")


def url_to_markdown(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        raise ValueError("Only http(s) URLs are supported")
    # Follow redirects manually so EVERY hop is validated against the SSRF
    # guard (a public URL may redirect to an internal one), and cap the body.
    with httpx.Client(follow_redirects=False, timeout=20) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            _assert_public_host(url)
            r = client.get(url)
            if r.is_redirect:
                url = str(r.next_request.url)
                continue
            r.raise_for_status()
            if len(r.content) > _MAX_MENU_BYTES:
                raise ValueError("That page is too large to digitize")
            break
        else:
            raise ValueError("Too many redirects")
    with tempfile.NamedTemporaryFile(suffix=".html", mode="w", encoding="utf-8") as f:
        f.write(r.text)
        f.flush()
        return _md().convert(f.name).text_content


def parse_menu_markdown(markdown: str) -> list[dict]:
    """Fast heuristic: 'Name … price' lines, tracking the latest heading."""
    items: list[dict] = []
    section = ""
    for raw in markdown.splitlines():
        line = raw.replace("**", "").strip()
        if not line:
            continue
        heading = re.match(r"^#{1,6}\s+(.*)$", line)
        if heading:
            section = heading.group(1).strip()
            continue
        m = _PRICE_RE.match(line)
        if m and len(m.group("name")) > 1:
            items.append({
                "section": section,
                "name": m.group("name").strip(),
                "price": m.group("price").strip(),
                "source": "heuristic",
            })
        elif len(line) < 40 and not re.search(r"\d", line):
            section = line
    return items


def structure_with_llm(markdown: str) -> list[dict]:
    from openai import OpenAI

    client = OpenAI(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
    )
    resp = client.chat.completions.create(
        model=os.environ.get("LLM_MODEL", "openai/gpt-oss-120b"),
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract restaurant menu items from markdown. Respond with ONLY a JSON "
                    'object of the form {"items":[{"section":string,"name":string,"price":string}]}. '
                    "Use the price exactly as printed (e.g. €12,50). \"section\" is the heading the "
                    "item falls under. Omit dish descriptions, allergen notes, and non-item text. "
                    "Preserve the menu's order."
                ),
            },
            {"role": "user", "content": markdown},
        ],
    )
    text = resp.choices[0].message.content or "{}"
    parsed = json.loads(text)
    items = parsed.get("items", []) if isinstance(parsed, dict) else []
    for it in items:
        it["source"] = "llm"
    return items


def digitize(*, data: str | None = None, url: str | None = None, mode: str = "fast") -> tuple[list[dict], str]:
    """Return (items, source). ``mode='ai'`` uses gpt-oss when configured."""
    markdown = pdf_to_markdown(data) if data else url_to_markdown(url or "")
    use_llm = mode == "ai" and llm_enabled()
    items = structure_with_llm(markdown) if use_llm else parse_menu_markdown(markdown)
    return items, ("llm" if use_llm else "heuristic")
