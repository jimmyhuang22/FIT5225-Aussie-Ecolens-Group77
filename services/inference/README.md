# Aussie EcoLens Inference Service

Python FastAPI service for the Aussie EcoLens ML inference path. It wraps
MegaDetector animal detection and the fine-tuned SpeciesNet classifier from the
assignment model assets behind a small HTTP API. The service is designed for GCP
Cloud Run, while the AWS processor Lambda calls it during upload processing.

```text
image
  -> MegaDetector (mdv5a.pt)
  -> crop animal bounding boxes
  -> resize to MD_SNIP_SIZE
  -> SpeciesNet classifier
  -> top-K species predictions
```

## Stack

- Python 3.11
- FastAPI + uvicorn
- PyTorch 2.4.1 CPU wheel
- MegaDetector
- google-cloud-storage for `gs://` model and image assets

## Required Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MODEL_PATH_MD` | Yes | - | Local path or `gs://...` URI to MegaDetector weights (`mdv5a.pt`) |
| `MODEL_PATH_SPECIES` | Yes | - | Local path or `gs://...` URI to SpeciesNet weights (`model.pt`) |
| `LABELS_PATH` | Yes | - | Local path or `gs://...` URI to `labels.txt` |
| `MODEL_VERSION_MD` | Yes | - | Version string echoed in `/inference` responses |
| `MODEL_VERSION_SPECIES` | Yes | - | Version string echoed in `/inference` responses |
| `MD_CONF_THRESHOLD` | No | `0.05` | MegaDetector confidence cutoff |
| `MD_SNIP_SIZE` | No | `600` | Square crop size before SpeciesNet |
| `SPECIES_TOP_K` | No | `3` | Default top-K predictions per detection |
| `INFERENCE_AUTH_MODE` | No | `iam` | `iam`, `api_key`, or `open` for local dev |
| `INFERENCE_API_KEY` | Conditional | - | Required when `INFERENCE_AUTH_MODE=api_key` |
| `INFERENCE_ALLOWED_IMAGE_URL_HOSTS` | No | AWS S3 hosts | Extra comma-separated HTTPS host patterns allowed for image URLs |
| `PORT` | No | `8080` | HTTP port uvicorn binds to |
| `LOG_LEVEL` | No | `INFO` | Python logging level |

For AWS Lambda integration, deploy Cloud Run with
`INFERENCE_AUTH_MODE=api_key`. Store the service-side key in Google Secret
Manager, store the caller-side key in AWS SSM Parameter Store, and make the AWS
processor send it in `X-Inference-Api-Key`. Keep `INFERENCE_AUTH_MODE=open` for
local development only.

## Local Quick Start

Create a local environment file and point it at the model assets:

```bash
cp .env.example .env
```

Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
```

Export the environment and start the service:

```bash
set -a
source .env
set +a
PYTHONPATH=src uvicorn inference.main:app --host 0.0.0.0 --port 8080
```

The first model-backed start opens roughly 471 MB of weights and may take a
while. Watch for `Inference service ready (version=...)`.

## API

### `GET /health`

```bash
curl http://localhost:8080/health
```

Example response:

```json
{
  "ok": true,
  "service": "inference",
  "models_loaded": true,
  "auth_mode": "open",
  "version": "0.1.0"
}
```

`/health` always returns HTTP 200 so Cloud Run can keep an instance alive while
models are still loading. Use `models_loaded` to decide whether `/inference`
can accept requests.

### `POST /inference`

Local request example:

```json
{
  "image": {
    "local_path": "/abs/path/to/Bos_taurus_1.JPG"
  },
  "top_k": 3
}
```

Exactly one of `gcs_uri`, `url`, `base64`, or `local_path` must be set.
`local_path` is honored only when `INFERENCE_AUTH_MODE=open`.

Deployed request example:

```bash
curl -X POST "$INFERENCE_URL/inference" \
  -H "X-Inference-Api-Key: $INFERENCE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image":{"url":"https://bucket.s3.amazonaws.com/key.jpg"},"top_k":3}'
```

Response shape:

```json
{
  "model_version": "speciesnet-au-v1+mdv5a-v1",
  "image": { "width": 1920, "height": 1080 },
  "detections": [
    {
      "bbox": { "x": 0.12, "y": 0.34, "w": 0.45, "h": 0.56 },
      "detection_confidence": 0.97,
      "predictions": [
        { "species": "Bos_taurus", "common_name": "cattle", "confidence": 0.91 }
      ]
    }
  ]
}
```

Common errors:

| Status | Body | Meaning |
|--------|------|---------|
| `400` | `invalid_image_source` / `invalid base64` / `invalid gcs_uri` | Bad image source |
| `400` | `local_path is only allowed when INFERENCE_AUTH_MODE=open` | Local path rejected outside local mode |
| `400` | `image_url_host_not_allowed` | URL host is outside the allowlist |
| `401` | `invalid_inference_api_key` | Missing or wrong `X-Inference-Api-Key` |
| `413` | `image_too_large` | base64 body > 10 MB or URL body > 25 MB |
| `502` | `image_fetch_failed: ...` | Remote image fetch failed |
| `503` | `models_not_loaded` | Models missing or still loading |
| `500` | `inference_failed: ...` | Unexpected MD + SpeciesNet failure |

## Auth Posture

Recommended assignment integration:

- Cloud Run uses `--allow-unauthenticated` so AWS Lambda can reach it without
  minting Google identity tokens.
- `/inference` is still protected by `INFERENCE_AUTH_MODE=api_key`.
- `/health` remains public for smoke checks and never reveals the API key.
- URL image sources must be HTTPS and match AWS S3 host patterns by default.
- `iam` mode remains available for a future private Cloud Run deployment.
- `open` mode disables all application-level auth and is local-only.

## Tests

```bash
pip install -e ".[dev]"
pytest
```

The tests cover schema validation, label parsing, local health behavior without
real model paths, and image URL/temporary-file hardening helpers.

## Evidence Capture

After starting the service locally with `INFERENCE_AUTH_MODE=open`, run:

```bash
python scripts/classify_test_images.py \
  --service-url http://localhost:8080 \
  --images-dir ../../test_images \
  --output ./evidence/inference-results.jsonl
```

The script posts each test image to `/inference`, writes one JSON line per
result, and prints a top-1 species histogram. Do not commit the `evidence/`
directory.

## Container Build And Deploy

The helper scripts under `services/inference/scripts/` are manual, billable cloud
actions. Review values before running them.

```bash
bash services/inference/scripts/enable-apis.sh
bash services/inference/scripts/upload-models.sh
bash services/inference/scripts/build-image.sh
bash services/inference/scripts/deploy-cloudrun.sh
```

Default Cloud Run settings used by `deploy-cloudrun.sh`:

| Flag | Value | Reason |
|------|-------|--------|
| `--min-instances` | `0` | Avoid idle Cloud Run instance charges |
| `--memory` | `4Gi` | PyTorch + MegaDetector + SpeciesNet need cold-start headroom |
| `--cpu` | `2` | Keeps CPU inference reasonable for the demo workload |
| `--concurrency` | `4` | Reuses one model load across a few requests |
| `--max-instances` | `3` | Student-account cost cap |
| `--timeout` | `60` | Gives model-backed inference room to complete |
| `--cpu-boost` | enabled | Faster model loading on cold start |
| `--allow-unauthenticated` | enabled | AWS Lambda can call Cloud Run over HTTPS |
| `INFERENCE_AUTH_MODE=api_key` | enabled | `/inference` requires `X-Inference-Api-Key` |

## Safety

- Never commit `.env`.
- Never commit `*.pt`, `*.pth`, or `*.onnx`.
- Redact `INFERENCE_API_KEY` from terminal output, screenshots, and reports.
- Prefer Secret Manager for Cloud Run and SSM Parameter Store for AWS Lambda.
- Redact bucket names and signed URLs if they are treated as sensitive.
- Do not deploy with `INFERENCE_AUTH_MODE=open`.
