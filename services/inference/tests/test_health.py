"""Endpoint tests for /health and /inference without real models loaded."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Force load_config(allow_missing_required=True) into the "no config" branch
    # so the test client boots cleanly without real model files.
    for key in (
        "MODEL_PATH_MD",
        "MODEL_PATH_SPECIES",
        "LABELS_PATH",
        "MODEL_VERSION_MD",
        "MODEL_VERSION_SPECIES",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LOG_LEVEL", "WARNING")

    # Re-import so the @app.lifespan picks up the cleared env.
    import importlib

    import inference.main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_health_models_not_loaded(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "inference"
    assert body["models_loaded"] is False


def test_inference_503_when_models_missing(client: TestClient) -> None:
    resp = client.post(
        "/inference",
        json={"image": {"url": "https://example.invalid/x.jpg"}, "top_k": 3},
    )
    assert resp.status_code == 503
    body = resp.json()
    assert body["error"] == "models_not_loaded"


def test_inference_rejects_zero_image_sources(client: TestClient) -> None:
    resp = client.post(
        "/inference",
        json={"image": {}, "top_k": 1},
    )
    # 422 because Pydantic rejects the request body before the route runs.
    assert resp.status_code == 422
