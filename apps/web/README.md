# Aussie EcoLens Web Frontend (Phase 2)

Vite + React + TypeScript SPA that drives the Phase 2 user journey:

```text
Sign Up -> Confirm Sign Up (email code) -> Sign In -> Profile (calls /api/me) -> Sign Out
```

Authentication is handled by **AWS Amplify Auth v6** against the AWS Cognito user pool created in Phase 1. The protected `/api/me` endpoint is served by `services/auth-proof` (Phase 1 + Phase 2 extension).

## Stack

- Vite + React 18 + TypeScript
- `react-router-dom` v6 for routing
- `aws-amplify` v6 for Cognito sign-up / confirm / sign-in / sign-out and access-token retrieval

## Auth Pattern Choice (Assignment Compliance)

The FIT5225 2026 S1 A2 brief (Section 3) explicitly permits two implementations:

> "You can implement login and sign-up web pages using **either the Hosted UI feature in Cognito or your own custom implementation that calls Cognito APIs**."

We chose the second path — a **custom UI in this Vite + React app that calls Cognito APIs via AWS Amplify Auth v6** — because:

1. The same React app is the foundation Phase 6 expands with media-management UI. A single design language across sign-up, profile, upload, query, and notifications avoids a jarring redirect to a different domain mid-demo.
2. Amplify v6's modular `signUp` / `confirmSignUp` / `signIn` / `signOut` / `fetchAuthSession` APIs give us identical JWTs to Hosted UI — the only difference is which page collects the credentials.
3. No Cognito domain provisioning is needed; the assignment's authentication evidence is captured via the Cognito console (user pool + app client + users list) + the browser DevTools (`Authorization: Bearer …` header on `/api/me`) + server-side `aws-jwt-verify` logs.

### Default redirect on unauthenticated access

Per Section 3: *"the user should be redirected to the sign-up page to register a new account"*. Both `RequireAuth` and the root `/` route send unauthenticated visitors to `/sign-up`. The sign-up page has an "Already have an account? Sign in" link so returning users can reach `/sign-in` in one click.

### Sign-up flow

We use **Cognito self-service sign-up with email verification by code** (NOT admin-created temporary password). The PDF's "temporary password" phrasing in Section 3 describes one variant of the verification flow; our self-sign-up + code-verification path satisfies the underlying requirement that "Cognito will send an email to new users, asking them to verify their email address" and is the more common pattern in modern Cognito deployments.

## Required Environment Variables

Vite only exposes `VITE_`-prefixed variables to client code. Real values live in `.env` (git-ignored).

| Variable | Source |
|----------|--------|
| `VITE_COGNITO_REGION` | AWS Console -> Cognito -> user pool region (e.g. `ap-southeast-2`) |
| `VITE_COGNITO_USER_POOL_ID` | AWS Console -> Cognito -> user pool overview |
| `VITE_COGNITO_APP_CLIENT_ID` | AWS Console -> Cognito -> App integration -> SPA app client (public, no client secret) |
| `VITE_API_BASE_URL` | Local: `http://localhost:8080`. Deployed: the Cloud Run service URL once Phase 6 / 7 deploys the UI |

## Local Setup

```powershell
Copy-Item .env.example .env
# Fill .env with values from the AWS Console (Cognito) and the running auth-proof API URL
npm install
npm run dev
```

The Vite dev server binds to `http://localhost:5173`, which matches the API service's `CORS_ALLOWED_ORIGINS` default so the protected fetch succeeds.

## Demo Flow

1. Open `http://localhost:5173`. Unauthenticated visitors are redirected to `/sign-in`.
2. Click "Sign Up". Fill email + first name + last name + password.
3. Receive the 6-digit verification code by email; enter it on `/confirm-sign-up`.
4. Sign in at `/sign-in`.
5. Land on `/profile`, which calls `GET /api/me` with the Cognito access token and renders the user object.
6. Click "Sign Out". Amplify calls `signOut({ global: true })`, which triggers Cognito global sign-out (refresh tokens revoked server-side) and clears local storage. The user is redirected to `/sign-in`.

## Demo-Grade Note

This frontend uses Amplify's default **localStorage** token storage. That is acceptable for assignment scope and demo evidence. Production-grade XSS hardening (CSP headers, httpOnly cookie-based session, etc.) is **not** in scope for Phase 2 — it would belong to a later hardening pass.

## Evidence Checklist

Capture for the report/demo folder (redact emails and JWTs before sharing):

- [ ] Sign-up form filled with test email, given name, family name, password.
- [ ] Cognito verification email landing in test inbox.
- [ ] Confirm-sign-up form with the code field populated.
- [ ] Cognito user record showing `CONFIRMED` status.
- [ ] Sign-in form submit succeeded.
- [ ] Profile page rendering the `user` object from `/api/me`.
- [ ] Browser DevTools network tab showing `Authorization: Bearer <REDACTED>` on the `/api/me` request.
- [ ] Sign Out clicked; redirect to `/sign-in`.
- [ ] Direct visit to `/profile` after sign-out — redirect to `/sign-in`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the Vite dev server on port 5173 |
| `npm run build` | TypeScript project build + Vite production build (output: `dist/`) |
| `npm run preview` | Serve the built `dist/` for smoke testing |
| `npm run check` | TypeScript-only build check, no emit |

## Phase Boundary

This package is the Phase 2 frontend foundation. Phase 6 (UI And Notifications) extends the same app with media upload, query, tag editor, and notification settings pages — no throwaway HTML.
