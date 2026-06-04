"""MegaDetector + SpeciesNet model loaders and per-image inference.

This module re-implements the inference loop from ``AussieEcoLense/batch.py``
as a single-image function suitable for an HTTP request handler.

Key quirks preserved from batch.py (DO NOT change without revalidating model
accuracy):

* SpeciesNet weights are a full pickled model, not a state_dict.  Load with
  ``torch.load(path, map_location="cpu", weights_only=False)``.
* The SpeciesNet ``forward`` expects channels-LAST input: shape (B, H, W, C).
  We resize to 480x480, ``ToTensor`` (which gives B,C,H,W), then permute to
  (B, H, W, C). No mean/std normalization is applied.
* MegaDetector categories: ``"1"`` = animal, ``"2"`` = person, ``"3"`` = vehicle.
  We only act on category ``"1"`` boxes above the confidence threshold.
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
        transforms.ToTensor(),  # produces (C, H, W) in [0, 1]
    ]
)


@dataclass
class LoadedModels:
    detector: Any
    classifier: Any
    labels: list[LabelEntry]


def load_megadetector(model_path: str | Path) -> Any:
    """Load the MegaDetector detector and return a reusable detector object.

    Uses the low-level loader so the model is read from disk exactly once. The
    detector exposes a ``generate_detections_one_image`` method that we call per
    request.
    """

    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"MegaDetector weights not found: {path}")

    LOG.info("Loading MegaDetector from %s (%.1f MB)", path, path.stat().st_size / 1e6)
    # Imported lazily so unit tests that never touch the model are not blocked by
    # the megadetector package being uninstalled.
    from megadetector.detection.run_detector import load_detector  # type: ignore import-untyped

    detector = load_detector(str(path))
    LOG.info("MegaDetector ready")
    return detector


def load_speciesnet(model_path: str | Path) -> torch.nn.Module:
    """Load the fine-tuned SpeciesNet PyTorch model on CPU and put in eval mode."""

    path = Path(model_path)
    if not path.is_file():
        raise FileNotFoundError(f"SpeciesNet weights not found: {path}")

    LOG.info(
        "Loading SpeciesNet from %s (%.1f MB)", path, path.stat().st_size / 1e6
    )
    # weights_only=False is REQUIRED — the .pt file contains a pickled model.
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
    tensor = _SPECIES_TRANSFORM(crop)  # (C, H, W)
    tensor = tensor.unsqueeze(0)  # (1, C, H, W)
    tensor = tensor.permute(0, 2, 3, 1).contiguous()  # (1, H, W, C) — channels-last

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
    """Run MegaDetector on a single image and return the ``detections`` list.

    The MegaDetector API varies across releases; this wrapper tries the
    documented entry points in order.
    """

    # Preferred: pass image_path as image_id so MegaDetector output keeps a
    # useful ``file`` field. Older releases also support a one-argument form.
    if hasattr(detector, "generate_detections_one_image"):
        with Image.open(image_path) as img:
            rgb = img.convert("RGB")
            try:
                result = detector.generate_detections_one_image(rgb, image_path)
            except TypeError:
                result = detector.generate_detections_one_image(rgb)
        return result.get("detections", []) if isinstance(result, dict) else []

    # Fallback: high-level batch helper for a single file.
    from megadetector.detection import run_detector_batch  # type: ignore import-untyped

    batch_result = run_detector_batch.load_and_run_detector_batch(
        image_file_names=[image_path],
        model_file=None,  # detector already loaded by caller
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
    """Run the full MD -> crop -> SpeciesNet pipeline on a single image."""

    detections_meta = _run_megadetector(loaded.detector, image_path)

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        width, height = img.size
        image_size = ImageSize(width=width, height=height)

        out: list[Detection] = []
        for det in detections_meta:
            if det.get("category") != "1":  # animal only
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
