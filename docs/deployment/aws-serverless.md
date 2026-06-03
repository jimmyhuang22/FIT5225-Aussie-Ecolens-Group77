# AWS Serverless Deployment Foundation

This guide documents the AWS foundation created for Aussie EcoLens. It covers
the infrastructure boundary only; the media API and processor business logic are
implemented by later workstreams.

## Stack Contents

The SAM template at `infra/aws-sam/template.yaml` creates:

- Cognito User Pool and public web app client
- Cognito PreSignUp Lambda for required `email`, `given_name`, and `family_name`
- API Gateway REST API protected by a Cognito authorizer
- API Lambda foundation handler
- S3 media bucket with upload CORS rules and public access blocked
- DynamoDB media, subscription, and deduplication tables
- SNS topic for tag-match email notifications
- Processor Lambda wired to S3 `uploads/` object-created events

## Prerequisites

- AWS CLI v2 configured for the target account
- AWS SAM CLI
- Docker, if building with `sam build --use-container`
- Permission to create or update Cognito, Lambda, API Gateway, S3, DynamoDB, SNS,
  IAM roles, and CloudFormation resources

## Validate

```bash
npm run sam:validate
```

Equivalent direct command:

```bash
sam validate --lint \
  --template-file infra/aws-sam/template.yaml \
  --region ap-southeast-2
```

## Build

```bash
npm run sam:build
```

Equivalent direct command:

```bash
sam build \
  --template-file infra/aws-sam/template.yaml \
  --use-container
```

## Deploy

```bash
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name aussie-ecolens-dev \
  --region ap-southeast-2 \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    AppName=aussie-ecolens \
    CognitoUserPoolName=aussie-ecolens-users \
    CognitoCallbackUrl=http://localhost:5173 \
    CognitoLogoutUrl=http://localhost:5173 \
    AllowedCorsOrigin=http://localhost:5173
```

When the Cloud Run inference service is available, add:

```bash
InferenceEndpointUrl=https://<cloud-run-service-url>
InferenceApiKey=<redacted>
```

Do not commit real API keys or copy them into screenshots.

## Outputs To Share With Frontend

After deployment, read stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name aussie-ecolens-dev \
  --region ap-southeast-2 \
  --query "Stacks[0].Outputs"
```

The frontend needs:

- `ApiBaseUrl` -> `VITE_API_BASE_URL`
- `CognitoUserPoolId` -> `VITE_COGNITO_USER_POOL_ID`
- `CognitoUserPoolClientId` -> `VITE_COGNITO_APP_CLIENT_ID`
- AWS region -> `VITE_COGNITO_REGION`

## Foundation Smoke Checks

The API foundation handler currently exposes a minimal authenticated root route.
After deployment and sign-in, call:

```bash
curl -H "Authorization: Bearer <cognito-id-token>" \
  "$ApiBaseUrl/"
```

Expected response:

```json
{
  "service": "aws-api",
  "status": "foundation_ready"
}
```

The processor foundation handler is wired to S3 object-created events under
`uploads/`. Later commits replace the placeholder response with checksum,
thumbnail, inference, metadata, and notification processing.

## IAM Notes

Lambda permissions are split by responsibility:

- API Lambda can presign uploads, read/delete owned media objects, query/update
  DynamoDB tables and indexes, and manage SNS email subscriptions.
- Processor Lambda can read uploaded media, write thumbnails, update media and
  dedup records, and publish SNS notifications.

The processor does not manage SNS subscriptions. The API Lambda retains
`Resource: "*"` only for SNS subscription attribute operations where AWS does
not consistently support topic-level resource scoping.

## Local-Only Files

Do not commit:

- `.aws-sam/`
- `.env` or real deployment parameter files
- AWS credentials or session tokens
- generated logs and screenshots containing account IDs or secrets without
  redaction
