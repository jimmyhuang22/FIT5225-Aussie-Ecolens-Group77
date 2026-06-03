"""Unit tests for the Pydantic request/response schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from inference.schemas import InferenceImage, InferenceRequest


def test_single_source_ok() -> None:
    img = InferenceImage(gcs_uri="gs://bucket/key.jpg")
    assert img.gcs_uri == "gs://bucket/key.jpg"


def test_no_source_raises() -> None:
    with pytest.raises(ValidationError):
        InferenceImage()


def test_two_sources_raises() -> None:
    with pytest.raises(ValidationError):
        InferenceImage(gcs_uri="gs://b/k.jpg", url="https://example/k.jpg")


def test_invalid_gcs_uri_raises() -> None:
    with pytest.raises(ValidationError):
        InferenceImage(gcs_uri="https://example/key.jpg")


def test_invalid_url_raises() -> None:
    with pytest.raises(ValidationError):
        InferenceImage(url="ftp://example/key.jpg")


def test_top_k_default() -> None:
    req = InferenceRequest(image=InferenceImage(url="https://example/k.jpg"))
    assert req.top_k == 3


def test_top_k_clamp() -> None:
    with pytest.raises(ValidationError):
        InferenceRequest(
            image=InferenceImage(url="https://example/k.jpg"),
            top_k=99,
        )
