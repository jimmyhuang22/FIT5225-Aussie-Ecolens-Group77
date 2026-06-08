# Aussie EcoLens Web Frontend

React/Vite/TypeScript single-page app for the deployed Aussie EcoLens media
workspace. It handles Cognito authentication, S3 upload orchestration, media
search, sharing controls, bulk tag editing, delete flows, and SNS subscription
management.

## Stack

- Vite + React 18 + TypeScript
- `react-router-dom` v6 for routing
- AWS Amplify Auth v6 for Cognito sign-up, confirmation, sign-in, sign-out, and
  Cognito ID token retrieval
- Radix UI primitives, Tailwind CSS, lucide icons, and `sonner` toasts

The app sends the Cognito ID token to the deployed AWS API Gateway as:

```http
Authorization: Bearer <Cognito ID token>
```

## Current Deployed Backend

```text
VITE_COGNITO_REGION=ap-southeast-2
VITE_COGNITO_USER_POOL_ID=ap-southeast-2_EfZfn63CN
VITE_COGNITO_APP_CLIENT_ID=5t6tjbcvts42tsork8ufc1ear7
VITE_API_BASE_URL=https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Vite only exposes `VITE_`-prefixed variables to browser code, and these values
are injected at build time. If they are missing during `npm run build`, the
deployed app will load but sign-up/sign-in will fail with an Auth UserPool
configuration error.

## Local Setup

From `apps/web`:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

For local development, `.env` should contain the deployed values above unless
you are intentionally pointing at another AWS stack.

## Production Build

If `.env` already contains the deployed values:

```powershell
npm run build
```

Or pass the values inline for a one-off build:

```powershell
$env:VITE_COGNITO_REGION="ap-southeast-2"
$env:VITE_COGNITO_USER_POOL_ID="ap-southeast-2_EfZfn63CN"
$env:VITE_COGNITO_APP_CLIENT_ID="5t6tjbcvts42tsork8ufc1ear7"
$env:VITE_API_BASE_URL="https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod"
npm run build
```

The production output is written to `apps/web/dist/`. The current assignment
deployment syncs that directory to:

```text
gs://aussie-ecolens-web-arched-vigil-490915-f7
```

After uploading, keep `index.html` on a short cache policy such as
`Cache-Control: no-cache, max-age=0` so browsers load the latest hashed JS
bundle.

## User Flows

- Sign up with email, first name, last name, and password.
- Confirm the Cognito email verification code.
- Sign in and load the protected Media workspace.
- Upload images or short videos; the browser calculates SHA-256 before upload.
- Track pending, processing, processed, failed, duplicate, and ignored states.
- Search by species, tag-count AND query, thumbnail URL, or temporary query
  image.
- View owned and shared media; owners can switch visibility and optional tag
  edit permission.
- Add/remove tags in bulk where the caller has permission.
- Delete selected media after confirmation.
- Create SNS email subscriptions, view pending/confirmed status, and remove
  subscriptions.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server on port 5173 |
| `npm run build` | TypeScript project build + Vite production build |
| `npm run preview` | Serve the built `dist/` locally for smoke testing |
| `npm run check` | TypeScript-only build check, no emit |

## Evidence Notes

Capture browser screenshots and DevTools evidence for:

- Cognito sign-up, email confirmation, sign-in, and sign-out.
- `Authorization: Bearer <redacted>` on protected API requests.
- Upload checksum message and processed media with thumbnail, tags, model
  version, and media URLs.
- Search results showing thumbnails and full-size media links.
- Sharing badges and `allowTagEdit` state.
- Delete confirmation text explaining storage, database, and dedup removal.
- SNS subscription status and confirmed email notification delivery.

Redact email addresses, JWTs, presigned URLs, API keys, and any screenshots that
show cloud account details before sharing externally.
