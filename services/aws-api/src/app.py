from __future__ import annotations

import json
import os
import time
from typing import Any


CORS_ALLOWED_ORIGIN = os.environ.get("CORS_ALLOWED_ORIGIN", "*")


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")

    if method == "OPTIONS":
        return _response(204, {})
    if method == "GET" and path.rstrip("/") in ("", "/"):
        return _response(
            200,
            {
                "service": "aws-api",
                "status": "foundation_ready",
                "time": _now(),
            },
        )
    return _response(404, {"error": "not_found"})


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": CORS_ALLOWED_ORIGIN,
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }
