from __future__ import annotations

from typing import Any


REQUIRED_ATTRIBUTES = {
    "email": "email",
    "given_name": "first name",
    "family_name": "last name",
}


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    attributes = event.get("request", {}).get("userAttributes") or {}
    missing = [
        label
        for name, label in REQUIRED_ATTRIBUTES.items()
        if not str(attributes.get(name, "")).strip()
    ]
    if missing:
        raise ValueError("Missing required sign-up attributes: " + ", ".join(missing))
    return event
