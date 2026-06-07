# AWS Upload Processor Lambda

This Lambda is triggered by `s3:ObjectCreated:*` for `uploads/` objects.

Processing flow:

1. Parse `mediaId` from `uploads/{ownerSub}/{mediaId}/{filename}`.
2. Load the pending DynamoDB media record.
3. Require `INFERENCE_ENDPOINT_URL` in deployed mode and call
   `INFERENCE_ENDPOINT_URL/inference`, passing a short-lived S3 presigned GET
   URL.
4. Only when `ALLOW_DEMO_FALLBACK=true` is explicitly set for local/demo
   testing, derive a demo tag from assignment test image filenames such as
   `Alectura_lathami_1.JPG` if no inference endpoint is configured.
5. Update the media record with `tags`, `tagCounts`, `modelVersion`, and `status`.
6. Publish an SNS message for matching active tag subscriptions.

The filename-based fallback is disabled by default so deployed environments fail
fast when the real GCP Cloud Run inference endpoint is missing.
