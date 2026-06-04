# Aussie EcoLens Inference Service (Phase 3)

Python FastAPI service that wraps **MegaDetector** (animal bounding-box detection) and the **fine-tuned SpeciesNet** classifier from `AussieEcoLense/batch.py` behind an HTTP API. Designed for GCP Cloud Run, but runnable locally for development and evidence capture.

```text
image
  -> MegaDetector (mdv5a.pt)
  -> crop animal bboxes (>= MD_CONF_THRESHOLD)
  -> resize to MD_SNIP_SIZE x MD_SNIP_SIZE
  -> SpeciesNet (model.pt) classifier
  -> top-K species + confidence
```

## Stack

- Python 3.11
- FastAPI + uvicorn
- PyTorch 2.4.1 (**CPU-only wheel** — see Install)
- MegaDetector
- google-cloud-storage (for `gs://` model + image fetches)

## Required Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MODEL_PATH_MD` | Yes | — | Local path or `gs://...` URI to MegaDetector weights (`.pt`) |
| `MODEL_PATH_SPECIES` | Yes | — | Local path or `gs://...` URI to fine-tuned SpeciesNet weights (`.pt`) |
| `LABELS_PATH` | Yes | — | Local path or `gs://...` URI to the semicolon-delimited `labels.txt` |
| `MODEL_VERSION_MD` | Yes | — | Version string echoed in `/inference` responses (e.g. `mdv5a-v1`) |
| `MODEL_VERSION_SPECIES` | Yes | — | Version string echoed in `/inference` responses (e.g. `speciesnet-au-v1`) |
| `MD_CONF_THRESHOLD` | No | `0.05` | MegaDetector bbox confidence cutoff |
| `MD_SNIP_SIZE` | No | `600` | Square crop pixel size before SpeciesNet |
| `SPECIES_TOP_K` | No | `3` | Default top-K predictions per detection (1–10) |
| `INFERENCE_AUTH_MODE` | No | `iam` | `iam` (Cloud Run default) or `open` (local dev — disables auth) |
| `PORT` | No | `8080` | HTTP port uvicorn binds to (Cloud Run injects 8080) |
| `LOG_LEVEL` | No | `INFO` | Python logging level |

For AWS Lambda integration, deploy Cloud Run with
`INFERENCE_AUTH_MODE=api_key` and provide the shared secret through
`INFERENCE_API_KEY_SECRET` in Google Secret Manager, or through the legacy
`INFERENCE_API_KEY` environment variable. The AWS processor sends the same value
in `X-Inference-Api-Key`. Keep `INFERENCE_AUTH_MODE=open` for local development
only.

## Local Quick Start (WSL or PowerShell)

```powershell
# 1. Copy the env template and fill local model paths
Copy-Item .env.example .env
# .env now points at ../../AussieEcoLense/{mdv5a.pt,model.pt,labels.txt}

# 2. Create a virtualenv and install the CPU-only PyTorch wheel
python -m venv .venv
.venv\Scripts\Activate.ps1            # PowerShell
# (WSL) source .venv/bin/activate
python -m pip install --upgrade pip
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# 3. Export the env (PowerShell example; WSL users use `export` in bash)
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
  }
}

# 4. Boot the service
uvicorn inference.main:app --app-dir src --host 0.0.0.0 --port 8080
```

The first start downloads / opens ~471 MB of weights and may take 10–30 seconds depending on disk speed. Watch the logs for `Inference service ready (version=...)`.

> **WSL note:** when running from WSL pointing at `/mnt/c/Users/.../AussieEcoLense/*.pt`, performance is reasonable but disk reads are slower than from native Linux filesystems. For Cloud Run the model is in GCS — not an issue.

## API

### `GET /health`

```bash
curl http://localhost:8080/health
```

```json
{
  "ok": true,
  "service": "inference",
  "models_loaded": true,
  "auth_mode": "open",
  "version": "0.1.0"
}
```

### `POST /inference`

Request:

```json
{
  "image": {
    "local_path": "/abs/path/to/Bos_taurus_1.JPG"
  },
  "top_k": 3
}
```

Exactly one of `gcs_uri`, `url`, `base64`, `local_path` must be set. `local_path` is honoured **only** when `INFERENCE_AUTH_MODE=open`.

Response:

```json
{
  "model_version": "speciesnet-au-v1+mdv5a-v1",
  "image": { "width": 1920, "height": 1080 },
  "detections": [
    {
      "bbox": { "x": 0.12, "y": 0.34, "w": 0.45, "h": 0.56 },
      "detection_confidence": 0.97,
      "predictions": [
        { "species": "Bos_taurus", "common_name": "cattle", "confidence": 0.91 },
        { "species": "Sus_scrofa", "common_name": "...", "confidence": 0.04 },
        { "species": "Macropus_giganteus", "common_name": "...", "confidence": 0.02 }
      ]
    }
  ]
}
```

Errors:

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `invalid_image_source` / `invalid base64` / `invalid gcs_uri` | Bad request shape |
| 400 | `local_path is only allowed when INFERENCE_AUTH_MODE=open` | Path source rejected outside local `open` mode |
| 413 | `image_too_large` | base64 > 10 MB or url body > 25 MB |
| 502 | `image_fetch_failed: ...` | URL/GCS fetch failed |
| 503 | `models_not_loaded` | Container still starting; retry shortly |
| 500 | `inference_failed: ...` | Unexpected error during MD + SpeciesNet |

### Auth Posture

Recommended assignment integration:

- Cloud Run is deployed with `--allow-unauthenticated` so AWS Lambda can call it
  without minting Google identity tokens.
- `/inference` is still protected by `INFERENCE_AUTH_MODE=api_key`; callers must
  send `X-Inference-Api-Key` matching `INFERENCE_API_KEY`.
- URL image sources are restricted to HTTPS AWS S3 hosts by default, with
  optional additions through `INFERENCE_ALLOWED_IMAGE_URL_HOSTS`.
- Prefer setting `INFERENCE_API_KEY_SECRET` to a Google Secret Manager secret
  name when running `deploy-cloudrun.sh`; the script grants the Cloud Run
  service account `roles/secretmanager.secretAccessor` and mounts the key as an
  environment variable without putting the value in the deploy command.
- `/health` remains public for smoke checks and does not reveal the API key.

- `iam` mode is still supported for a future private Cloud Run deployment where
  the caller can mint Google identity tokens.
- Local development sets `INFERENCE_AUTH_MODE=open` which **disables all authentication**. A `WARNING` log is emitted at startup so this can never silently leak.

## Tests

```powershell
pip install -e ".[dev]"
pytest
```

`tests/test_labels.py` exercises the labels parser against the real `AussieEcoLense/labels.txt` if present. `tests/test_schemas.py` verifies the Pydantic request validation. `tests/test_health.py` boots the FastAPI app without any model env vars and confirms `/health` and the `/inference` 503 path.

## Evidence Capture

After starting the service locally (with `INFERENCE_AUTH_MODE=open`), run:

```powershell
python scripts\classify_test_images.py \
  --service-url http://localhost:8080 \
  --images-dir ..\..\test_images \
  --output .\evidence\inference-results.jsonl
```

The script POSTs each `test_images/*.JPG` to `/inference`, writes one JSON line per result, and prints a top-1 species histogram. Output is the canonical Phase 3 ML success-criterion #5 evidence.

## Container Build And Deploy

See `services/inference/Dockerfile` (Cloud Run-compatible) and the scripts under `services/inference/scripts/`:

The current AWS integration path deploys Cloud Run with public platform access
and protects `/inference` using `INFERENCE_AUTH_MODE=api_key`. Set
`INFERENCE_API_KEY_SECRET` before running `deploy-cloudrun.sh`, then store the
same value in AWS SSM Parameter Store and pass its name to SAM as
`InferenceApiKeyParameterName`.

- `enable-apis.sh` — `gcloud services enable run.googleapis.com storage.googleapis.com ...`
- `upload-models.sh` — `gsutil cp` model + labels to `gs://aussie-ecolens-models/v1/`
- `build-image.sh` — `docker buildx build --platform linux/amd64 ... --push`
- `deploy-cloudrun.sh` — `gcloud run deploy ... --allow-unauthenticated --memory 4Gi`

**All four scripts are billable cloud actions.** They are invoked by the user, not by the automated workflow. See `.planning/phases/03-ml-inference-service/03-USER-SETUP.md` for the full walkthrough.

## Cloud Run Sizing

Default flag set used by `deploy-cloudrun.sh`:

| Flag | Value | Reason |
|------|-------|--------|
| `--min-instances` | 0 normally; 1 during live demo | Avoids idle Cloud Run instance charges during normal development; keeps one warm instance ready for demo |
| `--memory` | 4Gi | PyTorch + MegaDetector + SpeciesNet need headroom during cold start |
| `--cpu` | 2 | Keeps inference under ~10 s on CPU |
| `--concurrency` | 4 | Single model in memory; 4 concurrent requests share it |
| `--max-instances` | 3 | Cost cap for the student account |
| `--timeout` | 300s | Allows Cloud Run cold start + model loading to outlast the AWS 90s inference caller timeout |
| `--startup-cpu-boost` | enabled | Faster model load on cold start |
| `--allow-unauthenticated` | enabled | AWS Lambda can call Cloud Run without Google IAM token minting |
| `INFERENCE_AUTH_MODE=api_key` | enabled | `/inference` requires `X-Inference-Api-Key` |
| `INFERENCE_API_KEY_SECRET` | preferred | Cloud Run reads the key from Secret Manager instead of command-line env vars |

For live demos, redeploy with one warm instance and the longer platform timeout:

```bash
CLOUD_RUN_MIN_INSTANCES=1 CLOUD_RUN_TIMEOUT_SECONDS=300 \
  bash services/inference/scripts/deploy-cloudrun.sh
```

Then prewarm the service before showing the AWS upload flow:

```bash
curl "${CLOUD_RUN_URL}/health"
curl -X POST "${CLOUD_RUN_URL}/inference" \
  -H "X-Inference-Api-Key: <redacted>" \
  -H "Content-Type: application/json" \
  -d '{"image":{"url":"https://example/sample.jpg"}}'
```

After the demo, redeploy with `CLOUD_RUN_MIN_INSTANCES=0` to stop idle instance
charges.

## Safety

- Never commit `.env`.
- Never commit `*.pt`, `*.pth`, `*.onnx` (already in `.gitignore`).
- Redact `INFERENCE_API_KEY` everywhere: terminal screenshots, Cloud Run env screenshots, SAM commands, and report snippets. Prefer Secret Manager for Cloud Run and SSM Parameter Store for AWS Lambda deployments.
- Treat `INFERENCE_AUTH_MODE=open` as **development only**. The deploy script sets `INFERENCE_AUTH_MODE=api_key`.
- Redact bucket names and any embedded credentials before sharing screenshots of `/inference` requests or Cloud Run logs.
