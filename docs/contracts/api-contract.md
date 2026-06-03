# API Contract

## Conventions

- Base URL for Phase 1 proof: `https://<cloud-run-service-url>`.
- Protected endpoints require `Authorization: Bearer <Cognito JWT>`.
- Responses use JSON.
- Missing bearer tokens return `401 Unauthorized`.
- Malformed, expired, wrong issuer, wrong token use, or wrong app client tokens return `403 Forbidden`.
- Error responses should be safe to show in screenshots and must not include raw JWTs, passwords, client secrets, or service account data.

## Phase 1 Auth Proof Endpoints

### `GET /health`

Purpose: Prove the GCP Cloud Run service is deployed and reachable.

Auth: None.

Request headers:

```http
GET /health
```

Success response:

```json
{
  "ok": true,
  "service": "auth-proof"
}
```

Evidence to capture:

- Browser, curl, or Postman screenshot showing `200`.
- Cloud Run log line for the health request.

### `GET /protected/whoami`

Purpose: Prove that a Cognito-authenticated user can call a protected GCP endpoint.

Auth: Required.

Request headers:

```http
GET /protected/whoami
Authorization: Bearer <Cognito JWT>
```

Success response:

```json
{
  "authenticated": true,
  "provider": "aws-cognito",
  "runtime": "gcp-cloud-run",
  "claims": {
    "sub": "<cognito-user-sub>",
    "username": "<username-if-present>",
    "email": "<email-if-present>",
    "token_use": "access",
    "iss": "https://cognito-idp.<region>.amazonaws.com/<userPoolId>"
  }
}
```

Missing token response:

```json
{
  "error": "missing_bearer_token"
}
```

Status: `401 Unauthorized`.

Invalid token response:

```json
{
  "error": "invalid_token"
}
```

Status: `403 Forbidden`.

Evidence to capture:

- No-token request returning `401`.
- Malformed token request returning `403`.
- Valid Cognito token request returning sanitized user claims.
- GCP Cloud Run log showing the protected request.

## Phase 2 Protected Endpoints

### `GET /api/me`

Purpose: Return the authenticated user's identity to the web frontend (and any service-to-service caller carrying a Cognito access token).

Auth: Required (Cognito access token).

Request headers:

```http
GET /api/me
Authorization: Bearer <Cognito access token>
```

Success response (`200 OK`):

```json
{
  "user": {
    "sub": "<cognito-user-sub>",
    "username": "<email-used-as-username>",
    "email": "<email-if-present-or-null>",
    "given_name": "<first-name-if-present-or-null>",
    "family_name": "<last-name-if-present-or-null>",
    "token_use": "access"
  }
}
```

Notes:
- `email`, `given_name`, and `family_name` may be `null` because access tokens do not always include profile claims. The frontend supplements these from the ID token in its Amplify session for display purposes.
- The endpoint returns the same machine-readable error shape as `/protected/whoami` for failures.

Missing token response (`401 Unauthorized`):

```json
{ "error": "missing_bearer_token" }
```

Invalid token response (`403 Forbidden`):

```json
{ "error": "invalid_token" }
```

Evidence to capture:

- `GET /api/me` without token returning `401`.
- `GET /api/me` with malformed token returning `403`.
- `GET /api/me` with a valid Cognito access token returning the sanitized `user` payload.
- Cloud Run log line for the protected request.

## Auth Middleware Reuse

Phase 2 ships a reusable Express middleware at `services/auth-proof/src/middleware/requireCognitoAuth.js`. All future protected endpoints (Phase 4 upload, Phase 5 query / tag-edit / delete) MUST wrap their routes with this middleware so the 401 / 403 contract is enforced consistently. Example:

```js
const { requireCognitoAuth } = require("./middleware/requireCognitoAuth");

app.post("/media/upload-url", requireCognitoAuth, uploadUrlHandler);
```

Plan reviewers should reject any future protected endpoint that does not wrap its handler in `requireCognitoAuth`.

## Phase 3 Internal Endpoints (ML Inference)

Phase 3 introduces a dedicated inference service at `services/inference/`. It is internal to the application even though Cloud Run is deployed with `--allow-unauthenticated`: AWS Lambda reaches the service over HTTPS and `/inference` is protected by `INFERENCE_AUTH_MODE=api_key` plus the `X-Inference-Api-Key` header. Cognito JWTs do NOT flow to this service — user-level auth is enforced by the AWS API before it calls inference.

The caller pattern for the deployed `api_key` mode:

```bash
curl -X POST "<inference-service-url>/inference" \
  -H "X-Inference-Api-Key: <redacted>" \
  -H "Content-Type: application/json" \
  -d '{"image":{"url":"https://example/sample.jpg"}}'
```

### `GET /health`

Purpose: liveness + readiness for the inference service. Cloud Run startup probe should target this endpoint.

Auth: None. `/health` is public for smoke checks and reports the configured auth mode.

Success response (`200 OK`):

```json
{
  "ok": true,
  "service": "inference",
  "models_loaded": true,
  "auth_mode": "api_key",
  "version": "0.1.0"
}
```

While models are still loading, `models_loaded` is `false`. The service does NOT return non-200 from `/health` during load — Cloud Run uses HTTP status for the probe, and we want the platform to consider the instance alive while it boots.

### `POST /inference`

Purpose: Run MegaDetector + the fine-tuned SpeciesNet over a single image and return species predictions.

Auth: Required in deployed `api_key` mode via `X-Inference-Api-Key`. `iam` mode remains supported only for a future deployment that enables Cloud Run IAM and can mint Google identity tokens.

Request:

```json
{
  "image": {
    "gcs_uri": "gs://bucket/key.jpg"
  },
  "top_k": 3
}
```

Exactly one of `gcs_uri`, `url`, `base64`, `local_path` must be set. `local_path` is honored ONLY when the service runs with `INFERENCE_AUTH_MODE=open` (local development) and is rejected otherwise. `top_k` is optional, default `3`, range `1..10`.

Success response (`200 OK`):

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

- `bbox` is normalized (0..1) for portability across image sizes — Phase 4 may resize on the way in but the bbox stays normalized.
- `detections` is empty (with `200 OK`) when no animal is detected above `MD_CONF_THRESHOLD`. Callers should expect a possibly-empty list.
- `model_version` echoes the env-driven `MODEL_VERSION_SPECIES+MODEL_VERSION_MD` string so Phase 4 can persist it verbatim on `media_items.modelVersion`.

Error responses:

| Status | Body | Meaning |
|--------|------|---------|
| `400` | `{ "error": "invalid_image_source" }` | 0 or > 1 image fields set, or unrecognized source |
| `400` | `{ "error": "invalid base64" }` | base64 payload could not be decoded |
| `400` | `{ "error": "invalid gcs_uri" }` | URI does not start with `gs://` |
| `400` | `{ "error": "local_path is only allowed when INFERENCE_AUTH_MODE=open" }` | Local path source rejected outside local `open` mode |
| `401` | `{ "error": "invalid_inference_api_key" }` | Missing or incorrect `X-Inference-Api-Key` in `api_key` mode |
| `413` | `{ "error": "image_too_large" }` | base64 > 10 MB or URL body > 25 MB |
| `422` | (Pydantic validation error) | Malformed request body — e.g. missing `image` field |
| `502` | `{ "error": "image_fetch_failed: ..." }` | URL or GCS fetch failed |
| `503` | `{ "error": "models_not_loaded" }` | Container still booting; retry after a few seconds |
| `500` | `{ "error": "inference_failed: ..." }` | Unexpected error during inference |

### Inference Service Reuse In Later Phases

| Phase | Caller | How |
|-------|--------|-----|
| Upload pipeline | AWS processor Lambda | Sends `X-Inference-Api-Key` and an image URL/base64 payload to the deployed Cloud Run service |
| Query by file | AWS API Lambda | Accepts a temporary Cognito-protected query upload, forwards base64 to inference with `X-Inference-Api-Key`, and does NOT persist the query file in `media_items` |

## Current AWS API Summary

The authoritative current AWS API contract is
`docs/contracts/aws-api.md` plus `docs/contracts/openapi-aws.yaml`. The summary
below is kept only as a quick cross-reference from the earlier phase contract.

| Endpoint | Method | Auth | Purpose | Response notes |
|----------|--------|------|---------|----------------|
| `/media/upload-url` | `POST` | Required | Request signed upload URL or upload target metadata | Returns upload URL/object key and expected checksum workflow |
| `/media/{mediaId}/complete` | `POST` | Required | Mark an uploaded object ready for S3-triggered processing | Refuses to overwrite already processed or failed media |
| `/media` | `GET` | Required | List owned media, optionally filtered by tag/count | Returns fresh presigned URLs |
| `/media/query/tags` | `POST` | Required | Query by tag minimum counts | Uses AND semantics across all requested tags |
| `/media/query/thumbnail` | `POST` | Required | Resolve thumbnail URL to original media URL | Uses `thumbnailUrl` -> `originalUrl` mapping |
| `/media/query/file` | `POST` | Required | Detect tags from temporary query file and search stored media | Query file must not be persisted in `media_items` |
| `/media/tags/bulk` | `POST` | Required | Add/remove tags for a list of media URLs | `operation=1` add, `operation=0` remove |
| `/media/delete` | `POST` | Required | Delete originals, thumbnails, and DB records | Returns per-URL result |
| `/subscriptions` | `GET`/`POST` | Required | List or create tag notification subscriptions | Email subscriptions use SNS filter policies |
| `/subscriptions/{subscriptionId}` | `DELETE` | Required | Delete one subscription | Also updates/removes matching SNS email subscription state |

## Future Error Shape

```json
{
  "error": "machine_readable_code",
  "message": "Short safe explanation",
  "requestId": "<optional-log-correlation-id>"
}
```

Do not expose internal stack traces, raw tokens, bucket credentials, service account details, or model file paths in API errors.

## Link To Metadata Schema

Media endpoints must use the fields defined in `docs/contracts/metadata-schema.md`,
especially `mediaId`, `checksumSha256`, `tagCounts`, `thumbnailUrl`,
`originalUrl`, `ownerSub`, and `modelVersion`.
