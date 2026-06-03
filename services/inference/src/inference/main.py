"""FastAPI app for the Aussie EcoLens ML inference service.

The deployed Cloud Run service is reachable by AWS Lambda and protects
`/inference` with `INFERENCE_AUTH_MODE=api_key` plus `X-Inference-Api-Key`.
Local development can set `INFERENCE_AUTH_MODE=open`.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import logging
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import __version__
from .config import ConfigError, InferenceConfig, load_config
from .gcs import download_if_gcs, is_gcs_uri
from .labels import parse_labels
from .models import LoadedModels, infer_one_image, load_megadetector, load_speciesnet
from .schemas import (
    HealthResponse,
    InferenceImage,
    InferenceRequest,
    InferenceResponse,
)

LOG = logging.getLogger(__name__)

_MAX_BASE64_BYTES = 10 * 1024 * 1024
_MAX_URL_BYTES = 25 * 1024 * 1024
_MODEL_DOWNLOAD_DIR = Path("/tmp/aussie-ecolens-models")
_DEFAULT_ALLOWED_IMAGE_URL_HOSTS = (
    "s3.amazonaws.com",
    "*.s3.amazonaws.com",
    "*.s3.*.amazonaws.com",
)


@dataclass(frozen=True)
class ResolvedImage:
    path: str
    cleanup_required: bool


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    )


def _load_all(config: InferenceConfig) -> LoadedModels:
    _MODEL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    md_path = download_if_gcs(config.model_path_md, _MODEL_DOWNLOAD_DIR)
    species_path = download_if_gcs(config.model_path_species, _MODEL_DOWNLOAD_DIR)
    labels_path = download_if_gcs(config.labels_path, _MODEL_DOWNLOAD_DIR)

    labels = parse_labels(labels_path)
    LOG.info("Parsed %d label rows", len(labels))

    detector = load_megadetector(md_path)
    classifier = load_speciesnet(species_path)
    return LoadedModels(detector=detector, classifier=classifier, labels=labels)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    try:
        config = load_config(allow_missing_required=True)
    except ConfigError as exc:
        LOG.error("Configuration error: %s", exc)
        config = None

    log_level = (config.log_level if config else os.environ.get("LOG_LEVEL", "INFO")).upper()
    _configure_logging(log_level)

    if config is None:
        LOG.warning(
            "Required MODEL_* env vars are missing. /health works, /inference will return 503."
        )
        app.state.config = None
        app.state.loaded = None
        app.state.models_loaded = False
        yield
        return

    if config.auth_mode == "open":
        LOG.warning(
            "INFERENCE_AUTH_MODE=open: no authentication. Local development only; never deploy with this."
        )
    elif config.auth_mode == "api_key" and not config.inference_api_key:
        LOG.error("INFERENCE_AUTH_MODE=api_key requires INFERENCE_API_KEY.")
        app.state.config = config
        app.state.loaded = None
        app.state.models_loaded = False
        yield
        return

    app.state.config = config

    try:
        loaded = _load_all(config)
    except Exception:
        LOG.exception("Failed to load models; /inference will return 503.")
        app.state.loaded = None
        app.state.models_loaded = False
        yield
        return

    app.state.loaded = loaded
    app.state.models_loaded = True
    LOG.info("Inference service ready (version=%s).", config.combined_model_version)
    try:
        yield
    finally:
        LOG.info("Inference service shutting down.")


app = FastAPI(
    title="Aussie EcoLens Inference Service",
    version=__version__,
    lifespan=_lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    config: InferenceConfig | None = getattr(request.app.state, "config", None)
    auth_mode = config.auth_mode if config else "iam"
    return HealthResponse(
        models_loaded=bool(getattr(request.app.state, "models_loaded", False)),
        auth_mode=auth_mode,
        version=__version__,
    )


def _require_inference_auth(request: Request, config: InferenceConfig) -> None:
    if config.auth_mode in ("open", "iam"):
        return

    expected = config.inference_api_key
    if not expected:
        raise HTTPException(status_code=503, detail="inference_api_key_not_configured")

    provided = request.headers.get("x-inference-api-key", "")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid_inference_api_key")


async def _resolve_image(
    image: InferenceImage, *, allow_local_path: bool
) -> ResolvedImage:
    """Return a local filesystem path to the image bytes. Caller cleans up."""

    if image.local_path is not None:
        if not allow_local_path:
            raise HTTPException(
                status_code=400,
                detail="local_path is only allowed when INFERENCE_AUTH_MODE=open",
            )
        path = Path(image.local_path)
        if not path.is_file():
            raise HTTPException(status_code=400, detail=f"local_path not found: {path}")
        return ResolvedImage(str(path), cleanup_required=False)

    if image.gcs_uri is not None:
        if not is_gcs_uri(image.gcs_uri):
            raise HTTPException(status_code=400, detail="invalid gcs_uri")
        return ResolvedImage(
            download_if_gcs(image.gcs_uri, _MODEL_DOWNLOAD_DIR / "images"),
            cleanup_required=False,
        )

    if image.url is not None:
        _validate_image_url_allowed(image.url)
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                resp = await client.get(image.url)
            except httpx.HTTPError as exc:
                raise HTTPException(
                    status_code=502, detail=f"image_fetch_failed: {exc}"
                ) from exc
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"image_fetch_failed: status={resp.status_code}",
            )
        if len(resp.content) > _MAX_URL_BYTES:
            raise HTTPException(status_code=413, detail="image_too_large")
        tmp = Path(tempfile.gettempdir()) / f"aux-{uuid.uuid4().hex}.img"
        tmp.write_bytes(resp.content)
        return ResolvedImage(str(tmp), cleanup_required=True)

    if image.base64 is not None:
        try:
            decoded = base64.b64decode(image.base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="invalid base64") from exc
        if len(decoded) > _MAX_BASE64_BYTES:
            raise HTTPException(status_code=413, detail="image_too_large")
        tmp = Path(tempfile.gettempdir()) / f"aux-{uuid.uuid4().hex}.img"
        tmp.write_bytes(decoded)
        return ResolvedImage(str(tmp), cleanup_required=True)

    raise HTTPException(status_code=400, detail="invalid_image_source")


def _validate_image_url_allowed(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise HTTPException(status_code=400, detail="image_url_not_allowed")
    if not _host_allowed(host):
        raise HTTPException(status_code=400, detail="image_url_host_not_allowed")


def _host_allowed(host: str) -> bool:
    return any(fnmatchcase(host, pattern) for pattern in _allowed_image_url_hosts())


def _allowed_image_url_hosts() -> tuple[str, ...]:
    configured = tuple(
        host.strip().lower()
        for host in os.environ.get("INFERENCE_ALLOWED_IMAGE_URL_HOSTS", "").split(",")
        if host.strip()
    )
    return (*_DEFAULT_ALLOWED_IMAGE_URL_HOSTS, *configured)


def _cleanup_resolved_image(resolved: ResolvedImage) -> None:
    if resolved.cleanup_required:
        Path(resolved.path).unlink(missing_ok=True)


@app.post("/inference", response_model=InferenceResponse)
async def inference(request: Request, payload: InferenceRequest) -> InferenceResponse:
    if not getattr(request.app.state, "models_loaded", False):
        raise HTTPException(status_code=503, detail="models_not_loaded")

    config: InferenceConfig = request.app.state.config
    _require_inference_auth(request, config)
    loaded: LoadedModels = request.app.state.loaded

    resolved = await _resolve_image(
        payload.image, allow_local_path=(config.auth_mode == "open")
    )
    try:
        image_size, detections = infer_one_image(
            image_path=resolved.path,
            loaded=loaded,
            conf_threshold=config.md_conf_threshold,
            snip_size=config.md_snip_size,
            top_k=payload.top_k or config.species_top_k,
        )
    except HTTPException:
        raise
    except Exception as exc:
        LOG.exception("Inference failed for %s", resolved.path)
        raise HTTPException(status_code=500, detail=f"inference_failed: {exc}") from exc
    finally:
        _cleanup_resolved_image(resolved)

    return InferenceResponse(
        model_version=config.combined_model_version,
        image=image_size,
        detections=detections,
    )


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail if isinstance(exc.detail, str) else "error"},
    )
