from __future__ import annotations

import urllib.parse
from typing import Any


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    records = event.get("Records", [])
    uploads: list[dict[str, str]] = []
    for record in records:
        bucket = record.get("s3", {}).get("bucket", {}).get("name", "")
        key = urllib.parse.unquote_plus(
            record.get("s3", {}).get("object", {}).get("key", "")
        )
        if key.startswith("uploads/"):
            uploads.append({"bucket": bucket, "key": key})

    return {
        "service": "aws-processor",
        "status": "foundation_ready",
        "uploads": uploads,
    }
