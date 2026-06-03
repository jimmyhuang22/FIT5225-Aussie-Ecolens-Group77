# Repository Structure

This repository contains the Aussie EcoLens FIT5225 Assignment 2 multi-cloud
serverless wildlife media platform. The layout below is the intended project
structure for implementation and handoff between team members.

## Planned Structure

| Path | Purpose |
|---|---|
| `README.md` | Project overview and current setup notes |
| `package.json` | Root workspace scripts for frontend and AWS SAM workflows |
| `apps/web/` | React/Vite frontend for auth, media upload, queries, tag edits, delete, and subscriptions |
| `infra/aws-sam/` | AWS SAM template for Cognito, API Gateway, Lambda, S3, DynamoDB, and SNS |
| `services/aws-api/` | Protected AWS API Lambda for upload URLs, media queries, tag edits, delete, and subscriptions |
| `services/aws-presignup/` | Cognito PreSignUp trigger for required profile attributes |
| `services/aws-processor/` | S3 event processor Lambda for checksums, thumbnails, inference calls, video frames, and SNS publish |
| `services/inference/` | FastAPI Cloud Run service for MegaDetector and SpeciesNet inference |
| `docs/architecture/` | Architecture and cloud responsibility notes |
| `docs/contracts/` | API, metadata, and environment contracts |
| `docs/deployment/` | AWS and GCP deployment guides |
| `docs/evidence/` | Demo and marking evidence checklists |

## Commit And Handoff Rules

- Keep implementation commits focused on one module or workflow.
- Do not commit `.env` files, credentials, service account JSON, raw tokens, or screenshots containing secrets.
- Do not commit generated output such as `node_modules/`, `dist/`, `.aws-sam/`, caches, or Python bytecode.
- Do not commit large model binaries such as `*.pt`, `*.pth`, or `*.onnx`; document their cloud storage location instead.
- Update the relevant docs or contracts when an API, environment variable, or deployed service boundary changes.
