# AWS Upload Processor Lambda

This Lambda is triggered by `s3:ObjectCreated:*` for `uploads/` objects.

Processing flow:

1. Parse `mediaId` from `uploads/{ownerSub}/{mediaId}/{filename}`.
2. Load the pending DynamoDB media record.
3. Call `INFERENCE_ENDPOINT_URL/inference` when configured, passing a short-lived
   S3 presigned GET URL.
4. If no inference endpoint is configured, derive a demo tag from assignment test
   image filenames such as `Alectura_lathami_1.JPG`.
5. Update the media record with `tags`, `tagCounts`, `modelVersion`, and `status`.
6. Publish an SNS message for matching active tag subscriptions.
