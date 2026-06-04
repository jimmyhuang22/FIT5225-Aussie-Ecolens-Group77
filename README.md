# Aussie EcoLens

Aussie EcoLens is a FIT5225 Assignment 2 multi-cloud serverless wildlife media
platform. Authenticated users can upload wildlife images and videos, the system
classifies the media with MegaDetector + SpeciesNet, stores searchable metadata,
and notifies users when newly processed media matches their subscribed tags.

## Deployed Environment

| Component | Runtime | Current endpoint |
|---|---|---|
| Frontend | Google Cloud Storage static website | `https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html#/media` |
| AWS API | API Gateway + Lambda, `ap-southeast-2` | `https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod` |
| Inference | GCP Cloud Run, `australia-southeast1` | `https://aussie-ecolens-inference-506288567902.australia-southeast1.run.app` |

The deployed AWS stack is `aussie-ecolens-dev` in `ap-southeast-2`.

## Architecture

```text
React/Vite frontend on Google Cloud Storage
  -> AWS Cognito sign-up/sign-in
  -> API Gateway Cognito authorizer
  -> AWS API Lambda
  -> S3 presigned upload URL
  -> S3 media bucket
  -> S3 ObjectCreated event
  -> AWS processor Lambda
  -> GCP Cloud Run inference service
       MegaDetector + SpeciesNet
  -> DynamoDB media metadata and tag subscriptions
  -> SNS tag-match notification topic
  -> React UI search/delete/subscription views
```

AWS provides authentication, protected APIs, object storage, event processing,
DynamoDB metadata, and SNS notifications. GCP provides the public frontend and
the real model inference service. The upload processing path crosses cloud
boundaries when the AWS processor Lambda calls the GCP Cloud Run inference API
with `X-Inference-Api-Key`.

## Implementation Status

### Completed

- Cognito sign-up, email confirmation, sign-in, sign-out, and protected
  `GET /api/me`. A Cognito PreSignUp trigger rejects registrations that omit
  email, first name, or last name.
- Image and video upload through S3 presigned URLs.
- Required SHA-256 checksum workflow:
  - the browser calculates the checksum before upload,
  - the upload request requires `checksumSha256`,
  - the presigned S3 PUT includes `x-amz-meta-checksum-sha256`,
  - the processor recalculates the uploaded object's checksum before tagging.
- Owner-scoped duplicate detection using an atomic DynamoDB `DedupTable`
  reservation keyed by `ownerChecksumKey`.
- S3-triggered processor Lambda for upload processing.
- GCP Cloud Run inference with MegaDetector + SpeciesNet.
- Image thumbnails and first-frame video thumbnails.
- Video classification by sampling one frame per second across the full video by
  default. Video `tagCounts` use the maximum count seen in any single sampled
  frame, so one animal seen across multiple frames is not counted repeatedly.
  `VIDEO_MAX_FRAMES=0` means no artificial frame cap; extraction and processing
  budgets keep oversized jobs bounded. For live demos, use a 3-8 second clip;
  very long videos can exhaust the Lambda processing budget and will fail with a
  visible `processingError` instead of being silently truncated.
- Fresh presigned media URLs on API reads, so expired thumbnails recover after a
  refresh.
- Single-tag search and multi-tag AND/count search.
- Query-by-file for images using a temporary query image that is not persisted as
  media.
- Thumbnail-to-original media lookup.
- Manual bulk tag add/remove for selected media.
- Bulk URL delete through `POST /media/delete`, plus `DELETE /media/{mediaId}`
  for single-item UI convenience.
- Subscription create/list/delete UI and API.
- SNS email subscription creation with owner-and-tag route filter policies.
- Processor SNS publishing by matched owner/tag route, so a shared topic only
  delivers to confirmed subscriptions for the same signed-in user and tag.
- UI coverage for auth, upload, media status, processing errors, tag search,
  query-by-file, bulk tag editing, delete, and subscriptions.

### Remaining Evidence And Hardening

- Capture final live evidence for SNS email delivery after confirming at least
  two email subscriptions with different tags.
- Capture or refresh final Cloud Run model startup and `/inference` evidence if
  required for the report.
- Add more focused automated tests for query semantics, bulk delete, bulk tag
  edits, and processor failure paths.

See the detailed readiness review in
[docs/assignment-readiness.md](docs/assignment-readiness.md).

## Repository Map

| Path | Purpose |
|---|---|
| `apps/web/` | React/Vite frontend with Amplify Auth, media workspace, search, delete, bulk tag edit, and subscription UI |
| `infra/aws-sam/` | AWS SAM template for Cognito, API Gateway, Lambda, S3, DynamoDB, and SNS |
| `services/aws-api/` | Main protected AWS API Lambda |
| `services/aws-presignup/` | Cognito PreSignUp trigger that enforces required profile attributes |
| `services/aws-processor/` | S3 event processor Lambda for checksums, inference, thumbnails, tag aggregation, and SNS publish |
| `services/inference/` | FastAPI Cloud Run service for MegaDetector + SpeciesNet inference |
| `services/auth-proof/` | Earlier Cognito protected endpoint proof service |
| `docs/contracts/` | AWS API, OpenAPI, metadata, and environment contracts |
| `docs/deployment/` | AWS backend and Google frontend deployment guides |
| `docs/evidence/` | Screenshot, log, and API evidence checklists |
| `docs/architecture/` | Service map and multi-cloud architecture notes |

Do not commit local-only or generated files:

- `.env`, `.env.local`, tokens, passwords, service account files
- `.planning/`, `.codex/`, `.claude/`
- `node_modules/`, `dist/`, `.aws-sam/`
- `*.zip`, `*.pt`, `*.pth`, `*.onnx`
- assignment PDFs, raw model archives, large test image folders
- screenshots or evidence files containing unredacted secrets

## Local Frontend Setup

Prerequisites:

- Node.js 20+
- Git
- AWS CLI v2 and AWS SAM CLI for backend work
- Google Cloud SDK or WSL + `gcloud`/`gsutil` for Google deployments

Install frontend dependencies:

```powershell
git clone https://github.com/jimmyhuang22/FIT5225-Aussie-EcoLens.git
Set-Location FIT5225-Aussie-EcoLens
npm run web:install
```

Create the frontend environment file:

```powershell
Copy-Item apps/web/.env.example apps/web/.env
notepad apps/web/.env
```

Use these deployed development values:

```text
VITE_COGNITO_REGION=ap-southeast-2
VITE_COGNITO_USER_POOL_ID=ap-southeast-2_EfZfn63CN
VITE_COGNITO_APP_CLIENT_ID=5t6tjbcvts42tsork8ufc1ear7
VITE_API_BASE_URL=https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Run the frontend locally:

```powershell
npm run web:dev
```

Open:

```text
http://localhost:5173
```

Build:

```powershell
npm run web:build
```

## AWS Backend

Current stack outputs:

```text
ApiBaseUrl: https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod
CognitoUserPoolId: ap-southeast-2_EfZfn63CN
CognitoUserPoolClientId: 5t6tjbcvts42tsork8ufc1ear7
MediaBucketName: aussie-ecolens-900069969009-ap-southeast-2-media
MediaTableName: aussie-ecolens-dev-MediaTable-NG6IUHU2BECJ
SubscriptionTableName: aussie-ecolens-dev-SubscriptionTable-IWYEKUZ04DI8
```

Validate and build:

```powershell
sam validate --lint --template-file infra/aws-sam/template.yaml --region ap-southeast-2
sam build --template-file infra/aws-sam/template.yaml --use-container
```

Deploy:

```powershell
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name aussie-ecolens-dev `
  --region ap-southeast-2 `
  --capabilities CAPABILITY_IAM `
  --resolve-s3
```

Full guide:
[docs/deployment/aws-serverless.md](docs/deployment/aws-serverless.md)

## Google Frontend Hosting

The current public frontend is hosted from Google Cloud Storage:

```text
https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html#/media
```

Build and upload from this workspace:

```powershell
npm run web:build

wsl bash
BUCKET=aussie-ecolens-web-arched-vigil-490915-f7
DIST="$(pwd)/apps/web/dist"
GSUTIL=$HOME/.local/google-cloud-sdk/bin/gsutil
$GSUTIL -m rsync -r -d $DIST gs://$BUCKET
```

Firebase Hosting is documented as the preferred long-term static host if the
team account can enable Firebase. The current course account returned
`403 PERMISSION_DENIED` for enabling Firebase, so Cloud Storage is the working
fallback.

Full guide:
[docs/deployment/frontend-hosting.md](docs/deployment/frontend-hosting.md)

## Inference Service

The inference service is a FastAPI container deployed to Cloud Run. It loads
MegaDetector and SpeciesNet model assets from GCS and exposes:

- `GET /health`
- `POST /inference`

Current deployed auth posture:

- Cloud Run is deployed with `--allow-unauthenticated` so AWS Lambda can reach it
  without minting Google identity tokens.
- `/inference` is protected at the application layer with
  `INFERENCE_AUTH_MODE=api_key`.
- AWS sends the shared key through `X-Inference-Api-Key`.
- Deployed environments can load the AWS-side key from SSM Parameter Store via
  `InferenceApiKeyParameterName`, and the Cloud Run deploy script can mount the
  service-side key from Secret Manager via `INFERENCE_API_KEY_SECRET`.
- `INFERENCE_AUTH_MODE=open` is local-development only.

Full guide:
[services/inference/README.md](services/inference/README.md)

## API Contract

Protected AWS routes expect a Cognito ID token:

```http
Authorization: Bearer <Cognito ID token>
```

Implemented protected endpoints:

```text
GET    /api/me
POST   /media/upload-url
POST   /media/{mediaId}/complete
GET    /media
GET    /media/{mediaId}
POST   /media/query/tags
POST   /media/query/file
POST   /media/query/thumbnail
POST   /media/tags/bulk
POST   /media/delete
DELETE /media/{mediaId}
POST   /subscriptions
GET    /subscriptions
DELETE /subscriptions/{subscriptionId}
```

Primary contract docs:

- [docs/contracts/aws-api.md](docs/contracts/aws-api.md)
- [docs/contracts/openapi-aws.yaml](docs/contracts/openapi-aws.yaml)
- [docs/contracts/metadata-schema.md](docs/contracts/metadata-schema.md)
- [docs/contracts/env-contract.md](docs/contracts/env-contract.md)

## Manual Smoke Test

1. Open the public frontend or local dev server.
2. Sign up with an email address.
3. Confirm the Cognito email verification code.
4. Sign in.
5. Upload a test image such as `Alectura_lathami_1.JPG`.
6. Wait until the media status becomes `processed`.
7. Confirm that the thumbnail, tags, model version, and media URLs are shown.
8. Search by a detected tag.
9. Run a multi-tag/count search if the media has multiple tags.
10. Use image query-by-file and confirm the temporary query image is not listed as
    stored media.
11. Upload or inspect a 3-8 second video and confirm it has a first-frame
    thumbnail and sampled-frame tags. Avoid long videos in the live demo unless
    you are intentionally showing the visible timeout/failure path.
12. Add and remove manual tags on selected media.
13. Delete selected media through the UI and confirm it disappears from the list.
14. Create two subscriptions with different tags, confirm both SNS emails, then
    upload matching media to prove filter-policy delivery.

## Verification Commands

```powershell
# Frontend
npm run web:install
npm run web:build

# AWS Lambda syntax
python -m py_compile services/aws-api/src/app.py services/aws-processor/src/handler.py

# Inference service syntax
python -m py_compile services/inference/src/inference/main.py services/inference/scripts/classify_test_images.py

# AWS SAM
sam validate --lint --template-file infra/aws-sam/template.yaml --region ap-southeast-2
sam build --template-file infra/aws-sam/template.yaml --use-container

# Stack outputs
aws cloudformation describe-stacks `
  --stack-name aussie-ecolens-dev `
  --region ap-southeast-2 `
  --query "Stacks[0].Outputs"
```

If the local machine does not have SAM CLI, run validation through the official
SAM build image:

```bash
docker run --rm \
  -e SAM_CLI_TELEMETRY=0 \
  -v "$PWD:/workspace" \
  -w /workspace \
  public.ecr.aws/sam/build-python3.12:latest \
  sam validate --template-file infra/aws-sam/template.yaml --region ap-southeast-2 --lint
```

## Working With AI Assistants

Give assistants this starting context:

```text
You are working on Aussie EcoLens, a FIT5225 Assignment 2 multi-cloud serverless
wildlife media platform. Read README.md, docs/assignment-readiness.md,
docs/contracts/aws-api.md, docs/contracts/openapi-aws.yaml,
docs/contracts/metadata-schema.md, and docs/architecture/service-map.md first.

Use the existing stack:
- Frontend: apps/web React/Vite
- AWS backend: infra/aws-sam, services/aws-api, services/aws-processor
- Inference service: services/inference

Do not commit secrets, .env files, model weights, zip files, assignment PDFs,
node_modules, dist, .aws-sam, .planning, .codex, or .claude.

Before changing APIs, update docs/contracts. Before deploying AWS, run
sam validate --lint and sam build. Before changing frontend, run npm run
web:build. Keep changes scoped to assignment requirements and preserve Cognito
auth.
```

Recommended follow-up tasks:

- Capture final image/video processing evidence through the deployed Cloud Run
  inference service.
- Capture SNS email delivery evidence with confirmed owner/tag route filters,
  including a cross-account same-tag non-delivery check.
- Add focused automated tests for multi-tag query, query-by-file, bulk tag edit,
  bulk URL delete, and processor failure semantics.
- Prepare the final report architecture diagram and demo checklist.

## Branch And PR Rules

- Work on feature branches.
- Keep pull requests focused by workstream.
- Include requirement coverage and verification commands in PR descriptions.
- Redact screenshots before committing.
- Never push credentials, real tokens, API keys, service account JSON, or model
  weights.

## Safety

This repo should contain implementation code, deployment templates, contracts,
and redacted documentation only. Keep raw coursework packages, large model
assets, cloud credentials, local planning state, and generated build output out
of git.
