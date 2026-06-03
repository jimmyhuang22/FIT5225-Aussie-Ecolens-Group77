"""Environment configuration loader.

Required variables fail-fast at load time when missing. Optional variables have
documented defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Final
from typing import Literal

REQUIRED_VARS: Final[tuple[str, ...]] = (
    "MODEL_PATH_MD",
    "MODEL_PATH_SPECIES",
    "LABELS_PATH",
    "MODEL_VERSION_MD",
    "MODEL_VERSION_SPECIES",
)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


@dataclass(frozen=True)
class InferenceConfig:
    model_path_md: str
    model_path_species: str
    labels_path: str
    model_version_md: str
    model_version_species: str
    md_conf_threshold: float
    md_snip_size: int
    species_top_k: int
    auth_mode: Literal["iam", "api_key", "open"]
    inference_api_key: str | None
    port: int
    log_level: str

    @property
    def combined_model_version(self) -> str:
        """Single string echoed on every /inference response."""
        return f"{self.model_version_species}+{self.model_version_md}"


def _read_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def _read_optional(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _coerce_float(name: str, raw: str) -> float:
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a float; got {raw!r}") from exc


def _coerce_int(
    name: str, raw: str, *, minimum: int | None = None, maximum: int | None = None
) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an int; got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}; got {value}")
    if maximum is not None and value > maximum:
        raise ConfigError(f"{name} must be <= {maximum}; got {value}")
    return value


def load_config(*, allow_missing_required: bool = False) -> InferenceConfig | None:
    """Read config from os.environ.

    When ``allow_missing_required`` is True, missing required vars do NOT raise;
    instead, ``None`` is returned. This lets the FastAPI app boot and serve
    ``/health`` while model paths are not configured.
    """

    missing = [name for name in REQUIRED_VARS if not os.environ.get(name, "").strip()]
    if missing and not allow_missing_required:
        joined = ", ".join(missing)
        raise ConfigError(f"Missing required environment variables: {joined}")
    if missing:
        return None

    return InferenceConfig(
        model_path_md=_read_required("MODEL_PATH_MD"),
        model_path_species=_read_required("MODEL_PATH_SPECIES"),
        labels_path=_read_required("LABELS_PATH"),
        model_version_md=_read_required("MODEL_VERSION_MD"),
        model_version_species=_read_required("MODEL_VERSION_SPECIES"),
        md_conf_threshold=_coerce_float(
            "MD_CONF_THRESHOLD", _read_optional("MD_CONF_THRESHOLD", "0.05")
        ),
        md_snip_size=_coerce_int(
            "MD_SNIP_SIZE",
            _read_optional("MD_SNIP_SIZE", "600"),
            minimum=64,
            maximum=4096,
        ),
        species_top_k=_coerce_int(
            "SPECIES_TOP_K",
            _read_optional("SPECIES_TOP_K", "3"),
            minimum=1,
            maximum=10,
        ),
        auth_mode=_read_auth_mode(_read_optional("INFERENCE_AUTH_MODE", "iam")),
        inference_api_key=_read_api_key(),
        port=_coerce_int(
            "PORT", _read_optional("PORT", "8080"), minimum=1, maximum=65535
        ),
        log_level=_read_optional("LOG_LEVEL", "INFO").upper(),
    )


def _read_auth_mode(raw: str) -> Literal["iam", "api_key", "open"]:
    mode = raw.strip().lower()
    if mode in ("iam", "api_key", "open"):
        return mode
    raise ConfigError(f"INFERENCE_AUTH_MODE must be iam, api_key, or open; got {raw!r}")


def _read_api_key() -> str | None:
    value = os.environ.get("INFERENCE_API_KEY", "").strip()
    return value or None
