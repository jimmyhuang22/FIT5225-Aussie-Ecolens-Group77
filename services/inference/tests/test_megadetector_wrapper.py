"""Tests for MegaDetector API compatibility wrappers."""

from __future__ import annotations

import pytest

Image = pytest.importorskip("PIL.Image")
models = pytest.importorskip("inference.models")


class DetectorWithImageId:
    def __init__(self) -> None:
        self.calls: list[tuple[object, str]] = []

    def generate_detections_one_image(
        self, image: object, image_id: str
    ) -> dict[str, object]:
        self.calls.append((image, image_id))
        return {"detections": [{"category": "1", "conf": 0.9}]}


class DetectorWithoutImageId:
    def __init__(self) -> None:
        self.calls = 0

    def generate_detections_one_image(
        self, image: object, image_id: str | None = None
    ) -> dict[str, object]:
        if image_id is not None:
            raise TypeError("legacy detector accepts only the image")
        self.calls += 1
        return {"detections": [{"category": "1", "conf": 0.8}]}


@pytest.fixture()
def image_path(tmp_path):
    path = tmp_path / "camera-trap.jpg"
    Image.new("RGB", (8, 8), color="white").save(path)
    return str(path)


def test_megadetector_wrapper_passes_image_id_when_supported(image_path: str) -> None:
    detector = DetectorWithImageId()

    detections = models._run_megadetector(detector, image_path)

    assert detections == [{"category": "1", "conf": 0.9}]
    assert len(detector.calls) == 1
    assert detector.calls[0][1] == image_path


def test_megadetector_wrapper_falls_back_to_single_argument(image_path: str) -> None:
    detector = DetectorWithoutImageId()

    detections = models._run_megadetector(detector, image_path)

    assert detections == [{"category": "1", "conf": 0.8}]
    assert detector.calls == 1
