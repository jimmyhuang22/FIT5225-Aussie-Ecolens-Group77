#!/usr/bin/env python3
"""Phase 3 evidence-capture script.

Walks a directory of test images, POSTs each one to a running inference service,
and writes the responses to a JSONL file. Refuses to run unless the service
reports ``auth_mode == "open"`` so we never accidentally hammer a deployed
production endpoint.

Usage:
  python classify_test_images.py \
      --service-url http://localhost:8080 \
      --images-dir ../../../test_images \
      --output ./evidence/inference-results.jsonl \
      --top-k 3
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import httpx


def _abs_local_path(p: Path) -> str:
    return str(p.resolve())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service-url",
        default="http://localhost:8080",
        help="Inference service base URL (default: http://localhost:8080)",
    )
    parser.add_argument(
        "--images-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "test_images",
        help="Directory of JPG test images (default: repo test_images/)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "evidence" / "inference-results.jsonl",
        help="JSONL output path (default: services/inference/evidence/inference-results.jsonl)",
    )
    parser.add_argument(
        "--top-k", type=int, default=3, help="top-K predictions to request (1-10)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="If > 0, only classify the first N images (default: all)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.images_dir.is_dir():
        print(f"--images-dir not found: {args.images_dir}", file=sys.stderr)
        return 2

    with httpx.Client(base_url=args.service_url, timeout=120.0) as client:
        try:
            health = client.get("/health").json()
        except httpx.HTTPError as exc:
            print(f"Cannot reach {args.service_url}/health: {exc}", file=sys.stderr)
            return 3

        if health.get("auth_mode") != "open":
            print(
                "Refusing to run: target service is not in INFERENCE_AUTH_MODE=open. "
                "Use the API-key curl path for deployed services.",
                file=sys.stderr,
            )
            return 4

        if not health.get("models_loaded"):
            print(
                "Models are not loaded on the target service. Set MODEL_PATH_* env vars "
                "and restart, then re-run this script.",
                file=sys.stderr,
            )
            return 5

        images = sorted(
            p
            for p in args.images_dir.iterdir()
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )
        if args.limit > 0:
            images = images[: args.limit]
        if not images:
            print(f"No images found in {args.images_dir}", file=sys.stderr)
            return 6

        args.output.parent.mkdir(parents=True, exist_ok=True)
        successes = 0
        failures = 0
        top1_counter: Counter[str] = Counter()

        with args.output.open("w", encoding="utf-8") as out:
            for image in images:
                payload = {
                    "image": {"local_path": _abs_local_path(image)},
                    "top_k": args.top_k,
                }
                try:
                    resp = client.post("/inference", json=payload)
                except httpx.HTTPError as exc:
                    record = {"file": image.name, "status": "transport_error", "error": str(exc)}
                    failures += 1
                else:
                    if resp.status_code == 200:
                        body = resp.json()
                        successes += 1
                        for det in body.get("detections", []):
                            top = (det.get("predictions") or [{}])[0]
                            sp = top.get("species")
                            if sp:
                                top1_counter[sp] += 1
                        record = {
                            "file": image.name,
                            "status": "ok",
                            "model_version": body.get("model_version"),
                            "detections": body.get("detections", []),
                        }
                    else:
                        failures += 1
                        record = {
                            "file": image.name,
                            "status": f"http_{resp.status_code}",
                            "body": resp.text[:500],
                        }
                out.write(json.dumps(record) + "\n")
                print(
                    f"{image.name:40s}  {record['status']}",
                    flush=True,
                )

        print()
        print(f"Total: {len(images)}  Ok: {successes}  Failed: {failures}")
        print(f"Output: {args.output}")
        if top1_counter:
            print("Top-1 species histogram:")
            for species, count in top1_counter.most_common():
                print(f"  {species:30s} {count}")
        return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
