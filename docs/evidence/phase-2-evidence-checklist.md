# Phase 2 Evidence Checklist

Use this checklist while executing and demoing the Phase 2 Cognito sign-up / confirm / sign-in / sign-out flow plus the protected `/api/me` API. Redact raw JWTs, emails, account IDs, passwords, and secret values before sharing screenshots.

## Requirement Coverage

| Item | Evidence needed | Status |
|------|-----------------|--------|
| `ARCH-02` | curl/Postman screenshot of `/api/me` returning `200` with the `user` payload for a valid Cognito access token | Pending |
| `AUTH-01` | Cognito user pool overview screenshot showing email verification + PreSignUp trigger screenshot showing server-side enforcement of `email`, `given_name`, `family_name` + `apps/web` sign-up form screenshot showing email + first name + last name + password fields + confirmed user record screenshot | Pending |
| `AUTH-02` | Sign-in success screenshot from `apps/web` (Profile page loaded) + Sign Out screenshot showing redirect to `/sign-in` + Cognito-side evidence that global sign-out revoked the refresh token | Pending |
| `AUTH-03` | Browser request to `apps/web/profile` while unauthenticated showing redirect to `/sign-in` + direct `GET /api/me` (curl) returning `401` | Pending |
| `AUTH-04` | curl/Postman screenshots of `/api/me` returning `401` (no token) and `403` (malformed token) | Pending |

## Decision Coverage

| Decision | Evidence needed | Status |
|----------|-----------------|--------|
| `D2-01` | Cognito user pool screenshot showing `email` as required, plus Lambda trigger screenshot showing PreSignUp enforcement for `email`, `given_name`, and `family_name`. Existing Cognito pools cannot switch standard attributes between required and optional after creation without creating a new pool. | Pending |
| `D2-02` | Verification code email screenshot (redact email address) | Pending |
| `D2-03` | Cognito SPA app client screenshot (no client secret visible) | Pending |
| `D2-05` | `apps/web/package.json` listing `aws-amplify` dependency (already committed) | Done |
| `D2-06` | `apps/web/src/pages/SignUpPage.tsx` calls Amplify `signUp` (already committed) | Done |
| `D2-08` | `services/auth-proof/.env.example` sets `COGNITO_TOKEN_USE=access` (already committed) | Done |
| `D2-09` | `apps/web/src/pages/ProfilePage.tsx` calls `signOut({ global: true })` (already committed) | Done |
| `D2-11` | `services/auth-proof/src/server.js` extended in place — directory name preserved (already committed) | Done |
| `D2-12` | `services/auth-proof/src/middleware/requireCognitoAuth.js` exists and is wired into `/protected/whoami` and `/api/me` (already committed) | Done |
| `D2-13` | `/api/me` returns `{ user: {...} }` payload (verified locally; live evidence pending real token) | Partial |
| `D2-14` | `/protected/whoami` still returns Phase 1 shape after refactor (verified locally) | Done |
| `D2-15` | CORS preflight from `http://localhost:5173` returns `Access-Control-Allow-Origin: http://localhost:5173` (verified locally) | Done |
| `D2-17` | `apps/web/` directory listing screenshot showing Vite + React + Amplify structure | Pending |
| `D2-18` | `apps/web/profile` rendering live `/api/me` response | Pending |
| `D2-19` | `apps/web/.env.example` lists the four `VITE_*` keys (already committed) | Done |
| `D2-20` | `apps/web` running on `localhost:5173` only — no production deployment in Phase 2 (already committed) | Done |
| `D2-21` | This evidence checklist exists (this file) | Done |
| `D2-22` | Every screenshot in this checklist applies the redaction rules below | Pending per screenshot |
| `D2-23` | `docs/repo-structure.md` table shows `apps/web/`, `services/auth-proof/src/middleware/` (already committed) | Done |
| `D2-24` | Git history shows commits touching only `apps/web/**`, `services/auth-proof/**`, `docs/**`, `README.md` for Phase 2 (verifiable with `git log`) | Done |
| `D2-25` | No `git push` from the user's machine during Phase 2 until explicitly approved | Pending user approval |

## API Proof Checklist

| Proof | Command or location | Expected |
|-------|---------------------|----------|
| Health endpoint still works | `GET /health` | `200`, `{ "ok": true, "service": "auth-proof" }` |
| `/api/me` missing token | `GET /api/me` (no Authorization header) | `401`, `{ "error": "missing_bearer_token" }` |
| `/api/me` invalid token | `GET /api/me` with `Authorization: Bearer invalid.token.value` | `403`, `{ "error": "invalid_token" }` |
| `/api/me` valid token | `GET /api/me` with real Cognito access token | `200`, `{ user: { sub, username, email, given_name, family_name, token_use } }` |
| CORS preflight | Chrome DevTools network tab while loading Profile in `apps/web` | `OPTIONS /api/me` returns `204` with `Access-Control-Allow-Origin: http://localhost:5173` |
| Cloud Run logs | Cloud Run logs viewer (once deployed) | Request log line for `/api/me` |

## Frontend Workflow Screenshots

- [ ] `apps/web` sign-up form filled with test email, given name, family name, password.
- [ ] Cognito verification email landing in test inbox.
- [ ] `apps/web` confirm-sign-up form with the code field populated.
- [ ] Cognito user record showing `CONFIRMED` status after verification.
- [ ] `apps/web` sign-in form filled and submit succeeded.
- [ ] `apps/web` Profile page rendering the `user` object from `/api/me`.
- [ ] Browser DevTools network tab showing `Authorization: Bearer <REDACTED>` on the `/api/me` request.
- [ ] `apps/web` Sign Out clicked, redirect to `/sign-in`.
- [ ] Direct visit to `/profile` after sign-out — redirect to `/sign-in`.

## Cognito Configuration Screenshots

- [ ] Cognito user pool overview with email required and PreSignUp trigger configured.
- [ ] `PreSignUpFunction` code or Lambda console screenshot showing missing `email`, `given_name`, or `family_name` is rejected.
- [ ] Cognito SPA app client showing no client secret + ALLOW_USER_SRP_AUTH enabled.
- [ ] Allowed callback / sign-out URLs (or "not used — Amplify handles this") screenshot.

## Redaction Notes

- Do not show raw JWTs (access, ID, or refresh tokens).
- Do not show passwords or verification codes.
- Blur or crop personal email addresses unless using a dummy test email.
- Do not show AWS access keys, GCP service account JSON, or Cognito client secrets.
- Avoid exposing AWS account IDs unless the teaching team explicitly requires them.
- Redact the `Authorization: Bearer ...` header value in every DevTools screenshot before committing.
