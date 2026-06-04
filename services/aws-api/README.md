# AWS API Lambda

This Lambda backs the Cognito-protected REST API in `infra/aws-sam/template.yaml`.

Implemented endpoints:

- `GET /api/me`
- `POST /media/upload-url`
- `POST /media/{mediaId}/complete`
- `GET /media`
- `GET /media/{mediaId}`
- `POST /media/query/tags`
- `POST /media/query/file`
- `POST /media/query/thumbnail`
- `POST /media/tags/bulk`
- `POST /media/delete`
- `DELETE /media/{mediaId}`
- `POST /subscriptions`
- `GET /subscriptions`
- `DELETE /subscriptions/{subscriptionId}`

The API Gateway Cognito authorizer supplies the user claims. The Lambda stores media
records and subscriptions in DynamoDB, creates S3 presigned upload URLs, and only
returns records owned by the authenticated Cognito `sub`.

SNS email subscriptions are created with a `FilterPolicy` on the `routeKey`
message attribute, where each route key is `<ownerSub>#<tag>`. The processor
publishes one SNS event per detected watched tag with the same route key, so SNS
routes the event only to confirmed email subscriptions for that signed-in user
and tag.
