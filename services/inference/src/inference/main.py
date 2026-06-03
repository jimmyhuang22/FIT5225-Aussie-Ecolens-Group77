from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from . import __version__


app = FastAPI(
    title="Aussie EcoLens Inference Service",
    version=__version__,
)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "inference",
        "models_loaded": False,
        "auth_mode": os.environ.get("INFERENCE_AUTH_MODE", "open"),
        "version": __version__,
    }


@app.post("/inference")
async def inference() -> JSONResponse:
    raise HTTPException(status_code=503, detail="models_not_loaded")


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail if isinstance(exc.detail, str) else "error"},
    )
