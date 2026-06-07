# Phase 1 Evidence Checklist

Use this checklist while executing and demoing the Phase 1 architecture/auth proof. Redact raw JWTs, emails, account IDs, passwords, and secret values before sharing screenshots. Status values distinguish implemented repo evidence from live screenshots/logs that still need to be captured and redacted.

## Requirement Coverage

| Item | Evidence needed | Status |
|------|-----------------|--------|
| `ARCH-01` | Screenshot or diagram showing AWS Cognito and GCP Cloud Run both performing runtime roles | Implemented; capture final diagram/screenshot |
| `ARCH-03` | Cloud Run service screenshot or deployment log showing serverless/container runtime | Deployed; capture live evidence |
| `META-01` | `docs/contracts/metadata-schema.md` showing `checksumSha256`, `tagCounts`, URLs, owner, file type, and `modelVersion` | Done |

## Decision Coverage

| Decision | Evidence needed | Status |
|----------|-----------------|--------|
| `D-01` | Architecture doc states GCP is core development cloud | Done |
| `D-02` | Cognito user pool/app client screenshot | Live evidence to capture |
| `D-03` | Service map shows AWS identity provider and GCP application platform | Done |
| `D-04` | Successful Cognito token call to GCP Cloud Run endpoint | Superseded by API Gateway Cognito authorizer plus AWS-to-Cloud-Run API-key inference |
| `D-05` | Auth proof service exists under `services/auth-proof` | Done |
| `D-06` | Valid-token `/protected/whoami` response from GCP or local proof | Optional legacy proof; current protected API evidence is `/api/me` |
| `D-07` | Collected screenshots/logs for Cognito, Cloud Run, 401, 403, and success response | Live evidence to capture |
| `D-08` | Auth proof runs independently of upload/storage/query implementation | Done |
| `D-09` | API contract marks sign-up/login public and core endpoints protected | Done |
| `D-10` | Research/README documents Cognito JWT validation from GCP | Superseded by current Cognito authorizer documentation |
| `D-11` | No-token request returns `401`; malformed token returns `403` | Implemented; capture API evidence |
| `D-12` | `.gitignore` and env docs prevent committing secrets/tokens | Done |
| `D-13` | Service map, API contract, and metadata schema exist | Done |
| `D-14` | Metadata schema contains checksum, URLs, file type, owner, tag counts, and model version | Done |
| `D-15` | API contract includes auth and error behavior | Done |
| `D-16` | Repo structure doc explains team GitHub sync path | Done |

## API Proof Checklist

| Proof | Command or location | Expected |
|-------|---------------------|----------|
| Health endpoint | `GET /health` | `200`, `{ "ok": true, "service": "auth-proof" }` |
| Missing token | `GET /protected/whoami` with no `Authorization` header | `401`, `missing_bearer_token` |
| Invalid token | `GET /protected/whoami` with `Authorization: Bearer invalid.token.value` | `403`, `invalid_token` |
| Valid token | `GET /protected/whoami` with Cognito JWT | `200`, sanitized `claims` |
| Cloud logs | Cloud Run logs viewer | Request logs for health and protected endpoint |

## Screenshots To Capture

- [ ] AWS Cognito user pool overview.
- [ ] AWS Cognito app client configuration.
- [ ] Test user exists in Cognito.
- [ ] GCP Cloud Run service page.
- [ ] `/health` response.
- [ ] `/protected/whoami` `401`.
- [ ] `/protected/whoami` `403`.
- [ ] `/protected/whoami` valid-token success.
- [ ] GCP Cloud Run logs for protected requests.
- [ ] Architecture/service map or diagram based on `docs/architecture/service-map.md`.

## Redaction Notes

- Do not show raw JWTs.
- Do not show passwords.
- Blur or crop personal email addresses unless using a dummy test email.
- Do not show AWS access keys, GCP service account JSON, or client secrets.
- Avoid exposing account IDs unless the teaching team explicitly requires them.
