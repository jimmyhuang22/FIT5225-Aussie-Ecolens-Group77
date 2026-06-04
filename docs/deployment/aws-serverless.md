# AWS Serverless Deployment

This deployment makes AWS the main serverless runtime:

- Cognito: sign-up, sign-in, JWT authorizer.
- API Gateway: protected REST API.
- Lambda: media API and upload processor.
- S3: private original media storage.
- DynamoDB: media metadata and tag subscriptions.
- SNS: tag notification event topic.

The deployed stack should set `InferenceEndpointUrl` to the Cloud Run inference
service. The processor fails closed when this endpoint is missing. Filename-based
demo tagging is disabled by default and requires explicitly setting
`ALLOW_DEMO_FALLBACK=true` in the processor environment for local walkthroughs.

## Prerequisites

Install and configure:

- AWS CLI v2
- AWS SAM CLI
- Node.js 20+ for the web app
- An AWS account and region, for example `ap-southeast-2`

Login:

```powershell
aws configure
aws sts get-caller-identity
```

## Deploy The Backend

From the repository root:

```powershell
sam build --template-file infra/aws-sam/template.yaml --use-container
sam deploy --guided --template-file infra/aws-sam/template.yaml --stack-name aussie-ecolens-dev
```

Recommended guided values:

- AWS Region: `ap-southeast-2`
- `AppName`: `aussie-ecolens`
- `AllowedCorsOrigin`: `http://localhost:5173`
- `CognitoCallbackUrl`: `http://localhost:5173`
- `CognitoLogoutUrl`: `http://localhost:5173`
- `InferenceEndpointUrl`: leave blank for first demo, or set your deployed inference URL
- `InferenceApiKeyParameterName`: preferred for deployed environments; set this
  to an SSM SecureString parameter such as `/aussie-ecolens/dev/inference-api-key`
- `InferenceApiKey`: legacy fallback; leave blank when using
  `InferenceApiKeyParameterName`
- Confirm changes before deploy: `Y`
- Allow SAM CLI IAM role creation: `Y`
- Save arguments to configuration file: `Y`

After deploy, copy these stack outputs:

- `ApiBaseUrl`
- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `MediaBucketName`
- `NotificationTopicArn`

You can print them later:

```powershell
aws cloudformation describe-stacks `
  --stack-name aussie-ecolens-dev `
  --query "Stacks[0].Outputs"
```

## Configure The Web App

Create `apps/web/.env`:

```text
VITE_COGNITO_REGION=ap-southeast-2
VITE_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
VITE_COGNITO_APP_CLIENT_ID=<CognitoUserPoolClientId>
VITE_API_BASE_URL=<ApiBaseUrl>
```

Run locally:

```powershell
Set-Location apps/web
npm install
npm run dev
```

Open `http://localhost:5173`, sign up, confirm the email code, then sign in.

## Smoke Test The API

Use the frontend sign-in flow to obtain a Cognito ID token, or use a REST
client after login. The API Gateway REST Cognito authorizer expects the ID token
for these protected routes.

Create an upload URL:

```powershell
$token = "<Cognito ID token>"
$api = "<ApiBaseUrl>"
$file = "test_images/Alectura_lathami_1.JPG"
$checksum = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
$body = @{
  filename = "Alectura_lathami_1.JPG"
  contentType = "image/jpeg"
  mediaType = "image"
  sizeBytes = (Get-Item $file).Length
  checksumSha256 = $checksum
} | ConvertTo-Json

$upload = Invoke-RestMethod `
  -Method Post `
  -Uri "$api/media/upload-url" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

Upload a file to the returned S3 URL:

```powershell
Invoke-RestMethod `
  -Method Put `
  -Uri $upload.uploadUrl `
  -Headers @{
    "Content-Type" = $upload.uploadHeaders.'Content-Type'
    "x-amz-meta-checksum-sha256" = $upload.uploadHeaders.'x-amz-meta-checksum-sha256'
  } `
  -InFile $file
```

Wait a few seconds for the S3-triggered processor, then query media:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$api/media?tag=Alectura_lathami" `
  -Headers @{ Authorization = "Bearer $token" }
```

## Connect Real Inference

Deploy the existing `services/inference` container, then redeploy this SAM stack
with:

```powershell
sam deploy `
  --template-file infra/aws-sam/template.yaml `
  --stack-name aussie-ecolens-dev `
  --parameter-overrides `
    InferenceEndpointUrl=https://<your-inference-service-url> `
    InferenceApiKeyParameterName=/aussie-ecolens/dev/inference-api-key
```

Create the SSM parameter before deploying:

```powershell
aws ssm put-parameter `
  --name /aussie-ecolens/dev/inference-api-key `
  --type SecureString `
  --value "<same-key-as-cloud-run>" `
  --overwrite
```

The legacy `InferenceApiKey` parameter is marked `NoEcho`, but SSM SecureString
is preferred. Do not paste the real value into screenshots, commit messages,
reports, or shared chat.

The inference endpoint must accept:

```json
{
  "image": {
    "url": "https://presigned-s3-get-url"
  },
  "top_k": 3
}
```

and return the response shape documented in `docs/contracts/api-contract.md`.
When Cloud Run is deployed in `api_key` mode, the AWS processor sends
`X-Inference-Api-Key` on each request.

Keep the Cloud Run request timeout longer than the AWS inference caller timeout:
AWS API and processor Lambdas default `INFERENCE_TIMEOUT_SECONDS` to `90`, while
`deploy-cloudrun.sh` deploys Cloud Run with `CLOUD_RUN_TIMEOUT_SECONDS=300` by
default. This prevents Cloud Run from terminating a cold-starting model request
before AWS has finished waiting. For live demos, set `CLOUD_RUN_MIN_INSTANCES=1`
before the session, prewarm `/health` and one small `/inference` request, then
reset min instances to `0` afterwards to avoid idle charges.

## Evidence To Capture

- Cognito user pool and app client screenshots.
- Successful sign-up/sign-in frontend screenshots.
- API Gateway stage URL screenshot.
- S3 bucket object after upload.
- Lambda processor CloudWatch log showing the `mediaId`.
- DynamoDB media record with `tags` and `tagCounts`.
- Query response showing tag-based retrieval.
- SNS topic screenshot or published message evidence.

## Clean Up

```powershell
sam delete --stack-name aussie-ecolens-dev
```
