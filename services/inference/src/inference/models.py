"""MegaDetector + SpeciesNet model loaders and per-image inference.

This module re-implements the inference loop from ``AussieEcoLense/batch.py``
as a single-image function suitable for an HTTP request handler.

Key quirks preserved from batch.py:

* SpeciesNet weights are a full pickled model, not a state_dict. Load with
  ``torch.load(path, map_location="cpu", weights_only=False)``.
* The SpeciesNet forward pass expects channels-last input: shape (B, H, W, C).
* MegaDetector category ``"1"`` means animal; person and vehicle detections are
  ignored by this project.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from .labels import LabelEntry
from .schemas import BoundingBox, Detection, ImageSize, Prediction

LOG = logging.getLogger(__name__)

_SPECIES_TRANSFORM = transforms.Compose(
    [
        transforms.Resize((480, 480)),
        transforms.ToTensor(),
    ]
)


@dataclass
class LoadedModels:
    detector: Any
    classifier: Any
    labels: list[LabelEntry]


def load_megadetector(model_path: str | Path) -> Any:
    """Load MegaDetector weights and return a reusable detector."""

    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"MegaDetector weights not found: {path}")

    LOG.info("Loading MegaDetector from %s (%.1f MB)", path, path.stat().st_size / 1e6)
    from megadetector.detection.run_detector import load_detector  # type: ignore import-untyped

    detector = load_detector(str(path))
    LOG.info("MegaDetector ready")
    return detector


def load_speciesnet(model_path: str | Path) -> torch.nn.Module:
    """Load the fine-tuned SpeciesNet PyTorch model on CPU and put in eval mode."""

    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"SpeciesNet weights not found: {path}")

    LOG.info("Loading SpeciesNet from %s (%.1f MB)", path, path.stat().st_size / 1e6)
    model = torch.load(str(path), map_location="cpu", weights_only=False)
    if not isinstance(model, torch.nn.Module):
        raise TypeError(
            f"Expected a torch.nn.Module after load; got {type(model).__name__}"
        )
    model.eval()
    LOG.info("SpeciesNet ready (eval mode, cpu)")
    return model


def _classify_crop(
    crop: Image.Image,
    classifier: torch.nn.Module,
    labels: list[LabelEntry],
    top_k: int,
) -> list[Prediction]:
    tensor = _SPECIES_TRANSFORM(crop)
    tensor = tensor.unsqueeze(0)
    tensor = tensor.permute(0, 2, 3, 1).contiguous()

    with torch.no_grad():
        logits = classifier(tensor)
    probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

    if probs.shape[0] != len(labels):
        raise RuntimeError(
            f"SpeciesNet returned {probs.shape[0]} classes but labels file has "
            f"{len(labels)} rows. Refusing to map mismatched outputs."
        )

    order = np.argsort(probs)[::-1][:top_k]
    return [
        Prediction(
            species=labels[idx].species_key,
            common_name=labels[idx].common_name,
            confidence=float(probs[idx]),
        )
        for idx in order
    ]


def _run_megadetector(detector: Any, image_path: str) -> list[dict[str, Any]]:
    """Run MegaDetector on a single image and return the detections list."""

    if hasattr(detector, "generate_detections_one_image"):
        with Image.open(image_path) as img:
            result = detector.generate_detections_one_image(img.convert("RGB"))
        return result.get("detections", []) if isinstance(result, dict) else []

    from megadetector.detection import run_detector_batch  # type: ignore import-untyped

    batch_result = run_detector_batch.load_and_run_detector_batch(
        image_file_names=[image_path],
        model_file=None,
        loaded_detector=detector,
    )
    if not batch_result:
        return []
    return list(batch_result[0].get("detections", []))


def infer_one_image(
    *,
    image_path: str,
    loaded: LoadedModels,
    conf_threshold: float,
    snip_size: int,
    top_k: int,
) -> tuple[ImageSize, list[Detection]]:
    """Run the full MegaDetector -> crop -> SpeciesNet pipeline on one image."""

    detections_meta = _run_megadetector(loaded.detector, image_path)

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        width, height = img.size
        image_size = ImageSize(width=width, height=height)

        out: list[Detection] = []
        for det in detections_meta:
            if det.get("category") != "1":
                continue
            conf = float(det.get("conf", 0.0))
            if conf < conf_threshold:
                continue
            x, y, w, h = det.get("bbox", [0.0, 0.0, 0.0, 0.0])
            left = int(x * width)
            top = int(y * height)
            right = int((x + w) * width)
            bottom = int((y + h) * height)
            crop = img.crop((left, top, right, bottom))
            resized = crop.resize((snip_size, snip_size), Image.BILINEAR)

            predictions = _classify_crop(
                resized, loaded.classifier, loaded.labels, top_k
            )
            out.append(
                Detection(
                    bbox=BoundingBox(x=float(x), y=float(y), w=float(w), h=float(h)),
                    detection_confidence=conf,
                    predictions=predictions,
                )
            )

    return image_size, out
