# Auth Proof Service

This service is the Phase 1 cross-cloud proof for Aussie EcoLens:

```text
AWS Cognito login -> Cognito JWT -> GCP Cloud Run /protected/whoami
```

Cloud Run may be made publicly reachable for this proof only because the app performs Cognito JWT validation before returning protected data.

## Endpoints

| Endpoint | Auth | Expected behavior |
|----------|------|-------------------|
| `GET /health` | None | Returns `200` with `{ "ok": true, "service": "auth-proof" }` |
| `GET /protected/whoami` | Cognito bearer token | Returns sanitized user claims for a valid token |
| `GET /protected/whoami` | None | Returns `401` with `missing_bearer_token` |
| `GET /protected/whoami` | Invalid token | Returns `403` with `invalid_token` |
| `GET /api/me` | Cognito bearer token | Returns `{ user: { sub, username, email, given_name, family_name, token_use } }` for a valid token |
| `GET /api/me` | None | Returns `401` with `missing_bearer_token` |
| `GET /api/me` | Invalid token | Returns `403` with `invalid_token` |

## Required Configuration

Copy `.env.example` to `.env` locally and fill values from the AWS and GCP dashboards:

```powershell
Copy-Item .env.example .env
```

Required:

- `COGNITO_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_TOKEN_USE=access`
- `PORT=8080`
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CORS_ALLOWED_ORIGINS` — Comma-separated allowed browser origins. Defaults to `http://localhost:5173` when unset.

Do not commit `.env`, tokens, passwords, service account JSON, or screenshots that expose account secrets.

## Local Run

```powershell
npm install
npm run check
npm start
```

In another terminal:

```powershell
Invoke-RestMethod http://localhost:8080/health
```

Expected: `200` with `ok: true`.

No-token protected request:

```powershell
try {
  Invoke-RestMethod http://localhost:8080/protected/whoami
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

Expected: `401`.

Invalid-token protected request:

```powershell
try {
  Invoke-RestMethod http://localhost:8080/protected/whoami -Headers @{ Authorization = "Bearer invalid.token.value" }
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

Expected: `403`.

Valid-token protected request:

```powershell
$token = "<paste Cognito access token locally only>"
Invoke-RestMethod http://localhost:8080/protected/whoami -Headers @{ Authorization = "Bearer $token" }
```

Expected: `200` with `authenticated: true`, `provider: aws-cognito`, `runtime: gcp-cloud-run`, and sanitized claims.

## Docker Build

```powershell
docker build -t aussie-ecolens-auth-proof .
docker run --env-file .env -p 8080:8080 aussie-ecolens-auth-proof
```

## Cloud Run Deployment

From `services/auth-proof`:

```powershell
gcloud config set project <GCP_PROJECT_ID>
gcloud run deploy aussie-ecolens-auth-proof `
  --source . `
  --region <GCP_REGION> `
  --allow-unauthenticated `
  --set-env-vars COGNITO_REGION=<region>,COGNITO_USER_POOL_ID=<pool-id>,COGNITO_APP_CLIENT_ID=<client-id>,COGNITO_TOKEN_USE=access
```

Use a user-managed Cloud Run service account with least privilege when the service later accesses GCP resources. Do not commit service account JSON.

## Local Frontend Integration

Phase 2 ships a Vite + React + Amplify Auth frontend at `apps/web/` that signs users into Cognito and then calls `GET /api/me` on this service using the Cognito access token. Local dev expects:

- API service: `http://localhost:8080` (this service, `npm start`).
- Web frontend: `http://localhost:5173` (Vite dev server, `cd apps/web; npm run dev`).
- `CORS_ALLOWED_ORIGINS` includes `http://localhost:5173` so the browser fetch succeeds.

Smoke tests for `/api/me`:

```powershell
# /api/me without token returns 401
try { Invoke-RestMethod http://localhost:8080/api/me } catch { $_.Exception.Response.StatusCode.value__ }

# /api/me with malformed token returns 403
try { Invoke-RestMethod http://localhost:8080/api/me -Headers @{ Authorization = "Bearer invalid.token.value" } } catch { $_.Exception.Response.StatusCode.value__ }

# /api/me with a real Cognito access token returns the user object
$token = "<paste Cognito access token locally only>"
Invoke-RestMethod http://localhost:8080/api/me -Headers @{ Authorization = "Bearer $token" }
```

## Middleware Reuse For Later Phases

Phase 2 extracts the Cognito JWT verification logic into a reusable Express middleware at `src/middleware/requireCognitoAuth.js`. Future protected endpoints (Phase 4 upload, Phase 5 query/tag/delete) MUST wrap their route handlers in this middleware so the 401/403 contract is enforced consistently. Example:

```js
const { requireCognitoAuth } = require("./middleware/requireCognitoAuth");

app.post("/media/upload-url", requireCognitoAuth, uploadUrlHandler);
```

On success the middleware attaches the verified Cognito claims to `req.cognitoClaims` so the handler can read `sub` (the owner identity) without re-verifying.

## Evidence Checklist

Capture these for the report/demo folder:

- AWS Cognito user pool screenshot.
- AWS Cognito app client screenshot.
- GCP Cloud Run service screenshot.
- `/health` request returning `200`.
- `/protected/whoami` without token returning `401`.
- `/protected/whoami` with malformed token returning `403`.
- `/protected/whoami` with valid Cognito token returning sanitized claims.
- `/api/me` without token returning `401`.
- `/api/me` with malformed token returning `403`.
- `/api/me` with valid Cognito access token returning the `user` payload.
- Cloud Run logs showing protected endpoint requests.

Redact emails, account IDs, raw JWTs, and any sensitive values before sharing screenshots.
