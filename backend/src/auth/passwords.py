"""Password hashing (argon2id) and a light password policy."""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()  # argon2id defaults (memory-hard)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_problem(password: str, email: str) -> str | None:
    """Return a stable error CODE if the password is unacceptable, else None.
    The frontend maps the code to a localized, specific message."""
    if len(password) < 8:
        return "password_too_short"
    if len(password) > 200:
        return "password_too_long"
    if password.strip().lower() == email.strip().lower():
        return "password_is_email"
    return None
