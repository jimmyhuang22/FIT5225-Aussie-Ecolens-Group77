# Frontend Hosting Options

## Recommendation

Use Firebase Hosting for the React frontend when the account can enable Firebase
on the Google Cloud project. If the course/lab account cannot enable Firebase,
use Google Cloud Storage static hosting as the fallback. Keep the existing AWS
serverless backend in both cases.

Why:

- The frontend is a static Vite build, so it does not need server-side compute.
- Firebase Hosting has a no-cost Spark plan suitable for a small assignment demo.
- Hosting the UI on Google while the backend runs on AWS gives clear multi-cloud
  evidence without moving the working API.
- The team can still use the Google Cloud $300 trial for the model/inference side.

## Cost Snapshot

Pricing changes over time, so verify official pages before final submission.
As of the current check:

| Option | Cost posture | Notes |
|---|---|---|
| Firebase Hosting Spark | Usually cheapest for this frontend | No-cost plan, with Hosting quota. If quota is exceeded, service is limited unless upgraded. |
| AWS Amplify Hosting | Also low cost, very convenient with AWS backend | AWS lists a 12-month free tier with build minutes, CDN storage, and transfer quotas, then pay-as-you-go. |
| S3 + CloudFront | Low runtime cost, more setup | AWS now recommends Amplify Hosting for static website content stored on S3. |
| Cloud Run | Not ideal for this frontend | Good for containers/APIs, but static hosting is simpler and cheaper. |

## Deploy To Firebase Hosting

Prerequisites:

```powershell
npm install -g firebase-tools
firebase login
```

Create or select a Firebase project in the Firebase console. Then from the repo
root:

```powershell
Copy-Item .firebaserc.example .firebaserc
notepad .firebaserc
```

Set the project ID:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  }
}
```

Build and deploy:

```powershell
npm run web:install
npm run web:build
firebase deploy --only hosting
```

Or use the root convenience script:

```powershell
npm run firebase:deploy
```

Firebase returns a URL like:

```text
https://<project-id>.web.app
```

## Fallback: Deploy To Google Cloud Storage

If `firebase projects:addfirebase <project-id>` fails with `403 PERMISSION_DENIED`,
the account does not have permission to enable Firebase on that GCP project.
You can still host the static frontend on Google Cloud Storage:

```powershell
npm run web:build

wsl bash
BUCKET=aussie-ecolens-web-arched-vigil-490915-f7
PROJECT=arched-vigil-490915-f7
DIST=/mnt/c/Users/retur/Documents/code/Assignment2/apps/web/dist
GSUTIL=$HOME/.local/google-cloud-sdk/bin/gsutil

$GSUTIL mb -p $PROJECT -l australia-southeast1 gs://$BUCKET
$GSUTIL web set -m index.html -e index.html gs://$BUCKET
$GSUTIL -m rsync -r -d $DIST gs://$BUCKET
$GSUTIL setmeta -h Cache-Control:no-cache gs://$BUCKET/index.html
$GSUTIL iam ch allUsers:objectViewer gs://$BUCKET
```

Public URL:

```text
https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html#/media
```

The Cloud Storage fallback uses React hash routing. Use `index.html#/media`,
not `/media`; refreshing `/media` asks Google Storage for a bucket named
`media` and returns an XML access error.

## Update AWS After Hosting

After you know the Firebase URL, redeploy the AWS stack with that URL as the
Cognito callback/logout URL and API CORS origin:

```powershell
sam build --template-file infra/aws-sam/template.yaml --use-container

sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name aussie-ecolens-dev `
  --region ap-southeast-2 `
  --capabilities CAPABILITY_IAM `
  --resolve-s3 `
  --parameter-overrides `
    AppName=aussie-ecolens `
    CognitoUserPoolName=aussie-ecolens-users `
    CognitoCallbackUrl=https://<project-id>.web.app `
    CognitoLogoutUrl=https://<project-id>.web.app `
    AllowedCorsOrigin=https://<project-id>.web.app
```

For the Cloud Storage fallback, use:

```powershell
sam deploy `
  --template-file .aws-sam/build/template.yaml `
  --stack-name aussie-ecolens-dev `
  --region ap-southeast-2 `
  --capabilities CAPABILITY_IAM `
  --resolve-s3 `
  --parameter-overrides `
    AppName=aussie-ecolens `
    CognitoUserPoolName=aussie-ecolens-users `
    CognitoCallbackUrl=https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html `
    CognitoLogoutUrl=https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html `
    AllowedCorsOrigin=https://storage.googleapis.com
```

Then update `apps/web/.env` before building for Firebase:

```text
VITE_COGNITO_REGION=ap-southeast-2
VITE_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
VITE_COGNITO_APP_CLIENT_ID=<CognitoUserPoolClientId>
VITE_API_BASE_URL=<ApiBaseUrl>
```

## Evidence To Capture

- Firebase Hosting release screenshot and deployed URL.
- Cognito app client callback/logout URLs showing the Firebase URL.
- API Gateway CORS origin or SAM deploy command showing the Firebase URL.
- Browser demo from the Firebase URL:
  - sign up / confirm / sign in
  - upload media
  - query by tag
  - create/remove subscription
  - delete media
