"""Outbound email. Dev: log the link. Prod: wire SMTP here (later phase)."""
from __future__ import annotations

import logging

from .. import config

log = logging.getLogger("trending_table.email")


def verification_link(raw_token: str) -> str:
    return f"{config.APP_BASE_URL}/verify?token={raw_token}"


def send_verification(email: str, raw_token: str) -> None:
    link = verification_link(raw_token)
    # TODO(prod): send via SMTP/provider. In dev we log the link so it's usable.
    log.info("[email] verification for %s: %s", email, link)
    print(f"[email] verification for {email}: {link}", flush=True)
