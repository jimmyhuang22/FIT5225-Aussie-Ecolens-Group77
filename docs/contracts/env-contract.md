# Environment Contract

## Rule

This file lists configuration names only. Real values belong in local `.env` files, Cloud Run environment variables, AWS/GCP dashboards, or a managed secret store. Secrets and tokens are forbidden in git.

## Required Variables For Auth Proof

| Variable | Required | Secret? | Example placeholder | Purpose |
|----------|----------|---------|---------------------|---------|
| `COGNITO_REGION` | Yes | No | `ap-southeast-2` | AWS region containing the Cognito user pool |
| `COGNITO_USER_POOL_ID` | Yes | No | `ap-southeast-2_example` | Cognito user pool ID used to build issuer/JWKS URL |
| `COGNITO_APP_CLIENT_ID` | Yes | No | `exampleclientid` | App client/audience expected in token validation |
| `COGNITO_TOKEN_USE` | Yes | No | `access` | Expected token use, usually `access` for API calls |
| `PORT` | Yes | No | `8080` | Cloud Run HTTP port |
| `GCP_PROJECT_ID` | Deployment | No | `fit5225-aussie-ecolens` | GCP project for Cloud Run deployment |
| `GCP_REGION` | Deployment | No | `australia-southeast1` | Cloud Run deployment region |
| `CORS_ALLOWED_ORIGINS` | Later UI | No | `http://localhost:5173` | Allowed frontend origins when browser UI is added |

## Required Variables For Web Frontend (apps/web)

These are read at Vite build time and exposed to client code. Only `VITE_`-prefixed variables are ever embedded in the browser bundle.

| Variable | Required | Secret? | Example placeholder | Purpose |
|----------|----------|---------|---------------------|---------|
| `VITE_COGNITO_REGION` | Yes | No | `ap-southeast-2` | AWS region for Amplify Auth Cognito config |
| `VITE_COGNITO_USER_POOL_ID` | Yes | No | `ap-southeast-2_example` | Cognito user pool ID for sign-up / sign-in |
| `VITE_COGNITO_APP_CLIENT_ID` | Yes | No | `exampleclientid` | Cognito SPA app client (public, no client secret) |
| `VITE_API_BASE_URL` | Yes | No | `http://localhost:8080` | Base URL of the auth-proof API service (no trailing slash) |

Forbidden:
- Cognito *confidential* client secrets (the SPA client must be public).
- Any AWS access key, secret access key, or session token in `apps/web/.env`.

## Required Variables For Inference Service (services/inference)

| Variable | Required | Secret? | Example placeholder | Purpose |
|----------|----------|---------|---------------------|---------|
| `MODEL_PATH_MD` | Yes | No | `./AussieEcoLense/mdv5a.pt` or `gs://bucket/v1/mdv5a.pt` | MegaDetector weights location |
| `MODEL_PATH_SPECIES` | Yes | No | `./AussieEcoLense/model.pt` or `gs://bucket/v1/speciesnet-au-v1.pt` | Fine-tuned SpeciesNet weights location |
| `LABELS_PATH` | Yes | No | `./AussieEcoLense/labels.txt` or `gs://bucket/v1/labels.txt` | Semicolon-delimited species labels file |
| `MODEL_VERSION_MD` | Yes | No | `mdv5a-v1` | Version string echoed in `/inference` responses |
| `MODEL_VERSION_SPECIES` | Yes | No | `speciesnet-au-v1` | Version string echoed in `/inference` responses |
| `MD_CONF_THRESHOLD` | No | No | `0.05` | MegaDetector bbox confidence cutoff (default matches `AussieEcoLense/config.yaml`) |
| `MD_SNIP_SIZE` | No | No | `600` | Square crop pixel size before SpeciesNet (default matches `AussieEcoLense/config.yaml`) |
| `SPECIES_TOP_K` | No | No | `3` | Default top-K predictions per detection (1..10) |
| `INFERENCE_AUTH_MODE` | No | No | `iam` (Cloud Run default) or `open` (local dev — disables auth) | Application-level auth mode |
| `INFERENCE_API_KEY` | Deployed api_key mode | Yes | `<redacted>` | Shared key required by `/inference`; prefer Secret Manager or SSM over plain env vars |
| `INFERENCE_API_KEY_SECRET` | Cloud Run deployment preferred | No | `aussie-ecolens-inference-api-key` | Google Secret Manager secret name mounted by `deploy-cloudrun.sh` |
| `INFERENCE_API_KEY_PARAMETER_NAME` | AWS deployment preferred | No | `/aussie-ecolens/dev/inference-api-key` | SSM SecureString parameter name read by AWS Lambda |
| `INFERENCE_ALLOWED_IMAGE_URL_HOSTS` | No | No | `*.s3.ap-southeast-2.amazonaws.com` | Extra comma-separated HTTPS host patterns allowed for `/inference` URL image sources; AWS S3 host patterns are allowed by default |
| `PORT` | No | No | `8080` | HTTP port uvicorn binds to |
| `LOG_LEVEL` | No | No | `INFO` | Python logging level (DEBUG, INFO, WARNING, ERROR) |

Forbidden:
- `INFERENCE_AUTH_MODE=open` on any deployed Cloud Run service. Local development only.
- Any embedded GCP service account JSON inside `services/inference/.env`. The service uses Cloud Run's default service account in production and ADC locally.
- Plaintext API keys in screenshots, reports, shell history snippets, or committed env files.

## Forbidden In Git

The following must not be committed:

- Cognito passwords.
- Cognito app client secrets.
- Raw ID/access/refresh tokens.
- AWS access keys or secret access keys.
- GCP service account JSON.
- Private keys (`*.pem`, `*.key`).
- Local `.env` files with real cloud identifiers if the team treats those IDs as sensitive.
- Any logs or screenshots that reveal tokens, emails, account IDs, or secret values without redaction.

## Recommended Local Files

Track:

- `.env.example` with placeholders only.

Do not track:

- `.env`
- `.env.local`
- `.env.production`
- `apps/web/.env`
- `apps/web/.env.local`
- `services/inference/.env`
- `services/inference/.venv/`
- `services/inference/__pycache__/`
- `service-account.json`
- `tokens.txt`

## Runtime Validation Expectations

The auth proof service should fail fast with a clear startup or first-request error if any of these are missing:

- `COGNITO_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`

The error must name the missing variable but must not print secret values.

The web frontend (Phase 2) logs a startup `console.warn` if any of `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, or `VITE_COGNITO_APP_CLIENT_ID` is missing, but it does not block rendering — sign-up / sign-in calls will fail with a clear Amplify error until the values are set.

The inference service (Phase 3) fails fast at startup if any required `MODEL_*` variable is missing — the error names the missing variable. With required variables present but unreachable model paths (e.g. wrong GCS object), the service still serves `/health` (with `models_loaded=false`) and returns `503` from `/inference`, logging the underlying load error.
