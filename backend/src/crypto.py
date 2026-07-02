"""Symmetric encryption for secrets at rest (social OAuth tokens).

Uses Fernet with APP_SECRET_KEY (a urlsafe-base64 32-byte key — generate one with
``python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"``).
"""
from __future__ import annotations

import os

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    key = os.environ.get("APP_SECRET_KEY")
    if not key:
        raise RuntimeError("APP_SECRET_KEY is not set (needed to encrypt secrets).")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str | None) -> str | None:
    if plaintext is None:
        return None
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if token is None:
        return None
    return _fernet().decrypt(token.encode()).decode()
