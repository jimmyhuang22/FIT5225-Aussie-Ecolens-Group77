"""Pydantic v2 request and response schemas for the inference HTTP API."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class InferenceImage(BaseModel):
    """Exactly one of the four image-source fields must be set."""

    model_config = {"extra": "forbid"}

    gcs_uri: str | None = Field(
        default=None, description="GCS URI like gs://bucket/key.jpg"
    )
    url: str | None = Field(
        default=None, description="HTTPS URL to fetch the image from"
    )
    base64: str | None = Field(
        default=None,
        description="Base64-encoded image bytes (no data URI prefix). Max ~10 MB.",
    )
    local_path: str | None = Field(
        default=None,
        description="Filesystem path inside the container. ONLY honored when INFERENCE_AUTH_MODE=open.",
    )

    @field_validator("gcs_uri")
    @classmethod
    def _gcs_uri_shape(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("gs://"):
            raise ValueError("gcs_uri must start with gs://")
        return value

    @field_validator("url")
    @classmethod
    def _url_shape(cls, value: str | None) -> str | None:
        if value is not None and not (
            value.startswith("http://") or value.startswith("https://")
        ):
            raise ValueError("url must start with http:// or https://")
        return value

    @model_validator(mode="after")
    def _exactly_one(self) -> "InferenceImage":
        provided = sum(
            1
            for field in (self.gcs_uri, self.url, self.base64, self.local_path)
            if field
        )
        if provided != 1:
            raise ValueError(
                "Exactly one of gcs_uri, url, base64, local_path must be set"
            )
        return self


class InferenceRequest(BaseModel):
    model_config = {"extra": "forbid"}

    image: InferenceImage
    top_k: Annotated[int, Field(ge=1, le=10)] = 3


class Prediction(BaseModel):
    species: str = Field(description="Genus_species key, e.g. Bos_taurus")
    common_name: str
    confidence: float


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class Detection(BaseModel):
    bbox: BoundingBox
    detection_confidence: float
    predictions: list[Prediction]


class ImageSize(BaseModel):
    width: int
    height: int


class InferenceResponse(BaseModel):
    model_version: str
    image: ImageSize
    detections: list[Detection]


class HealthResponse(BaseModel):
    ok: bool = True
    service: Literal["inference"] = "inference"
    models_loaded: bool
    auth_mode: Literal["iam", "api_key", "open"] = "iam"
    version: str = "0.1.0"
