# Environment Contract

This document lists configuration names only. Real values belong in local
`.env` files, AWS/GCP consoles, deployment parameters, or managed secret stores.
Secrets, tokens, and credentials must not be committed.

## Frontend Variables

These variables are read by Vite and embedded into the browser bundle. Only
`VITE_` variables should be used by client-side code.

| Variable | Required | Secret? | Purpose |
|---|---:|---:|---|
| `VITE_COGNITO_REGION` | Yes | No | AWS region containing the Cognito user pool |
| `VITE_COGNITO_USER_POOL_ID` | Yes | No | Cognito user pool ID for Amplify Auth |
| `VITE_COGNITO_APP_CLIENT_ID` | Yes | No | Public Cognito SPA app client ID |
| `VITE_API_BASE_URL` | Yes | No | Base URL for the protected AWS API |

Frontend code must not contain AWS access keys, Cognito confidential client
secrets, service account JSON, or raw JWTs.

## AWS Backend Variables

These variables are provided to API and processor Lambdas through the SAM
template.

| Variable | Required | Secret? | Purpose |
|---|---:|---:|---|
| `MEDIA_BUCKET` | Yes | No | S3 bucket for originals and thumbnails |
| `MEDIA_TABLE` | Yes | No | DynamoDB media metadata table |
| `SUBSCRIPTION_TABLE` | Yes | No | DynamoDB tag subscription table |
| `DEDUP_TABLE` | Yes | No | DynamoDB checksum reservation table |
| `NOTIFICATION_TOPIC_ARN` | Yes | No | SNS topic used for tag-match email notifications |
| `CORS_ALLOWED_ORIGIN` | Yes | No | Browser origin allowed by API responses |
| `PRESIGNED_URL_TTL_SECONDS` | No | No | Expiry for upload URLs |
| `INFERENCE_ENDPOINT_URL` | Deployed processing | No | Cloud Run inference service base URL |
| `INFERENCE_API_KEY` | Deployed api-key mode | Yes | Shared key sent to the inference endpoint |
| `INFERENCE_API_KEY_PARAMETER_NAME` | Preferred deployed mode | No | SSM SecureString parameter name containing the inference API key |
| `INFERENCE_TOP_K` | No | No | Number of species predictions requested per detection |
| `INFERENCE_TIMEOUT_SECONDS` | No | No | HTTP timeout for inference calls |

Prefer `INFERENCE_API_KEY_PARAMETER_NAME` over plaintext `INFERENCE_API_KEY` for
deployed AWS resources.

## Inference Service Variables

These variables configure the Cloud Run FastAPI inference service.

| Variable | Required | Secret? | Purpose |
|---|---:|---:|---|
| `MODEL_PATH_MD` | Yes | No | MegaDetector model path or GCS URI |
| `MODEL_PATH_SPECIES` | Yes | No | SpeciesNet model path or GCS URI |
| `LABELS_PATH` | Yes | No | Species labels path or GCS URI |
| `MODEL_VERSION_MD` | Yes | No | MegaDetector version string |
| `MODEL_VERSION_SPECIES` | Yes | No | SpeciesNet version string |
| `MD_CONF_THRESHOLD` | No | No | MegaDetector confidence threshold |
| `MD_SNIP_SIZE` | No | No | Crop size used before SpeciesNet classification |
| `SPECIES_TOP_K` | No | No | Default number of species predictions |
| `INFERENCE_AUTH_MODE` | Yes | No | `api_key` for deployed service, `open` only for local development |
| `INFERENCE_API_KEY` | api-key mode | Yes | Shared key required by `/inference` |
| `INFERENCE_API_KEY_SECRET` | Preferred deployed mode | No | Google Secret Manager secret mounted by Cloud Run deployment |
| `INFERENCE_ALLOWED_IMAGE_URL_HOSTS` | No | No | Extra HTTPS host patterns allowed for URL image sources |
| `PORT` | No | No | HTTP port used by Cloud Run |
| `LOG_LEVEL` | No | No | Python logging level |

`INFERENCE_AUTH_MODE=open` is local-development only and must not be used for a
deployed Cloud Run service.

## Forbidden In Git

- `.env`, `.env.local`, `.env.production`, and real deployment env files
- AWS access keys, secret access keys, and session tokens
- Cognito passwords, app client secrets, or raw JWTs
- GCP service account JSON and private keys
- Model binaries such as `*.pt`, `*.pth`, or `*.onnx`
- Logs or screenshots that reveal credentials, tokens, emails, or account IDs
  without redaction

Track `.env.example` files with placeholders only.
