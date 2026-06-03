# Inference Service

This service is the GCP Cloud Run runtime for Aussie EcoLens model inference.
It will host the MegaDetector + SpeciesNet pipeline used by the AWS processor
Lambda and query-by-file API.

The initial scaffold exposes:

- `GET /health`
- `POST /inference`

The request and response schemas are defined in
`src/inference/schemas.py`. `POST /inference` accepts exactly one image source
(`gcs_uri`, `url`, `base64`, or `local_path`) and returns
`503 models_not_loaded` until model loading is added in later commits.

The model layer is split into:

- `src/inference/gcs.py` for GCS URI resolution and downloads
- `src/inference/labels.py` for parsing the semicolon-delimited labels file
- `src/inference/models.py` for MegaDetector and SpeciesNet loading plus
  per-image inference helpers

When all required model environment variables are present, the app downloads any
`gs://` model assets at startup, loads MegaDetector and SpeciesNet once, and
serves model-backed `/inference` responses. If model paths are missing or fail
to load, `/health` still responds with `models_loaded=false` and `/inference`
returns `503 models_not_loaded`.

In deployed `api_key` mode, `/inference` requires `X-Inference-Api-Key`.
`local_path` inputs are accepted only when `INFERENCE_AUTH_MODE=open`. URL image
sources must use HTTPS and match the default AWS S3 host allowlist or
`INFERENCE_ALLOWED_IMAGE_URL_HOSTS`.

## Local Development

Create a local environment file:

```bash
cp .env.example .env
```

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

Run the service:

```bash
PYTHONPATH=src uvicorn inference.main:app --reload --host 0.0.0.0 --port 8080
```

Open:

```text
http://localhost:8080/health
```

## Container

Build from this directory:

```bash
docker build -t aussie-ecolens-inference .
```

Run:

```bash
docker run --rm -p 8080:8080 aussie-ecolens-inference
```
