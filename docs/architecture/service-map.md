# Service Map

This document defines the planned Aussie EcoLens multi-cloud service boundary.
It is the shared reference for frontend, AWS backend, inference, and deployment
workstreams.

## End-To-End Flow

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

## Runtime Responsibilities

| Service | Cloud | Responsibility |
|---|---|---|
| React/Vite frontend | GCP | Browser UI for sign-up, sign-in, upload, media query, tag edits, delete, and subscription workflows |
| Cognito User Pool | AWS | User registration, email verification, sign-in identity, and JWT claims |
| API Gateway | AWS | Protected REST entry point using a Cognito authorizer |
| API Lambda | AWS | Authenticated media, query, tag edit, delete, and subscription API handlers |
| S3 media bucket | AWS | Private storage for uploaded images, videos, and generated thumbnails |
| Processor Lambda | AWS | S3 event handling, checksum verification, thumbnail generation, video frame sampling, inference calls, metadata updates, and SNS publish |
| DynamoDB media table | AWS | Media metadata, owner, status, tags, tagCounts, URLs, checksum, and processing errors |
| DynamoDB subscription table | AWS | User tag subscription preferences |
| SNS topic | AWS | Email notification delivery for matching owner/tag events |
| Cloud Run inference service | GCP | MegaDetector + SpeciesNet HTTP inference endpoint |
| GCS model bucket | GCP | Model weights and label files loaded by Cloud Run |

## Multi-Cloud Rationale

AWS is responsible for authentication, protected APIs, storage triggers,
metadata, and notifications. GCP is responsible for public static hosting and
the containerized ML inference service. The upload processing path crosses cloud
boundaries when the AWS processor Lambda calls the GCP Cloud Run inference API.

## Security Boundary

- Browser users authenticate through AWS Cognito.
- Business API routes are protected by API Gateway and Cognito JWTs.
- Media objects stay private in S3 and are exposed through short-lived
  presigned URLs.
- Cloud Run inference accepts calls from AWS with application-level shared-key
  protection in deployed environments.
- Secrets belong in managed secret stores or local untracked `.env` files, never
  in Git.
