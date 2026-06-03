from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from . import __version__
from .config import ConfigError, load_config
from .schemas import HealthResponse, InferenceRequest


app = FastAPI(
    title="Aussie EcoLens Inference Service",
    version=__version__,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    try:
        config = load_config(allow_missing_required=True)
    except ConfigError:
        config = None
    return HealthResponse(
        models_loaded=False,
        auth_mode=config.auth_mode if config else os.environ.get("INFERENCE_AUTH_MODE", "iam"),
        version=__version__,
    )


@app.post("/inference")
async def inference(_payload: InferenceRequest) -> JSONResponse:
    raise HTTPException(status_code=503, detail="models_not_loaded")


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail if isinstance(exc.detail, str) else "error"},
    )
