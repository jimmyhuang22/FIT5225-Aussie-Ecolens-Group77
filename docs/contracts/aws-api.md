# AWS Serverless API Contract

Base URL:

```text
https://vwalnc3mxc.execute-api.ap-southeast-2.amazonaws.com/Prod
```

All business endpoints require a Cognito JWT. The current API Gateway REST
Cognito authorizer accepts the Cognito ID token produced by the web app:

```http
Authorization: Bearer <Cognito ID token>
```

The API is protected by an API Gateway Cognito authorizer. Missing or invalid
tokens are rejected before the Lambda handler runs.

## Auth

### `GET /api/me`

Returns the authenticated Cognito identity.

Success:

```json
{
  "user": {
    "sub": "194eb478-8091-706e-fe8d-3f0eb3b4ea60",
    "username": "user@example.com",
    "email": "user@example.com",
    "given_name": null,
    "family_name": null,
    "token_use": "id"
  }
}
```

Expected failures:

| Status | Meaning |
|---|---|
| `401` | Missing bearer token |
| `401` / `403` | Invalid, expired, wrong token type, or wrong Cognito token |

## Media

### `POST /media/upload-url`

Creates a pending media record and returns an S3 presigned PUT URL.
Before creating the media record, the API atomically reserves the owner's
`ownerSub#checksumSha256` key in `DedupTable`; this prevents concurrent requests
for the same file from creating two records. If the caller already owns a
non-deleted media record with the same `checksumSha256` and the S3 object exists,
the API returns the existing record and does not issue a new S3 upload URL. A
stale pending media record without an S3 object is not treated as a completed
duplicate; while the reservation is still active, the API reissues an upload URL
for the same media record instead of creating a second one. `checksumSha256` is
required and must be the browser-calculated 64-character SHA-256 hex digest of
the file bytes. The backend also validates `mediaType`, `contentType`, filename
extension, and `sizeBytes` before it signs any S3 PUT URL.

Request:

```json
{
  "filename": "Alectura_lathami_1.JPG",
  "contentType": "image/jpeg",
  "mediaType": "image",
  "sizeBytes": 2457600,
  "checksumSha256": "f2ca1bb6c7e907d06dafe4687e579fce6f5f8a1d22fba0a3f1d49e52d1f1c0ab"
}
```

Success:

```json
{
  "duplicate": false,
  "mediaId": "media_abc123",
  "uploadUrl": "https://...",
  "uploadHeaders": {
    "Content-Type": "image/jpeg",
    "x-amz-meta-checksum-sha256": "f2ca1bb6c7e907d06dafe4687e579fce6f5f8a1d22fba0a3f1d49e52d1f1c0ab"
  },
  "bucket": "aussie-ecolens-<account-id>-ap-southeast-2-media",
  "objectKey": "uploads/<ownerSub>/<mediaId>/Alectura_lathami_1.JPG",
  "expiresIn": 900
}
```

Duplicate success:

```json
{
  "duplicate": true,
  "mediaId": "media_existing",
  "uploadUrl": null,
  "uploadHeaders": {},
  "bucket": "aussie-ecolens-<account-id>-ap-southeast-2-media",
  "objectKey": "uploads/<ownerSub>/<mediaId>/Alectura_lathami_1.JPG",
  "expiresIn": 0,
  "media": {
    "mediaId": "media_existing",
    "status": "processed"
  }
}
```

Upload the file with:

```http
PUT <uploadUrl>
Content-Type: image/jpeg
x-amz-meta-checksum-sha256: <same checksumSha256>
```

The upload processor recalculates SHA-256 from the stored S3 object and compares
it with both DynamoDB `checksumSha256` and the S3 object metadata. Mismatches are
marked as `failed` and surfaced through `processingError`.

### `POST /media/{mediaId}/complete`

Marks the client upload as complete. The S3 event processor will independently
update the record to `processed` after tagging finishes.

Success:

```json
{
  "media": {
    "mediaId": "media_abc123",
    "status": "uploaded"
  }
}
```

### `GET /media`

Lists media accessible to the authenticated user: records they own plus records
other users have explicitly marked as `visibility=shared`.
The API returns fresh presigned `originalUrl` and `thumbnailUrl` values on each
read so old browser sessions do not keep using expired S3 URLs.

Optional query parameters:

| Parameter | Example | Meaning |
|---|---|---|
| `tag` | `alectura_lathami` | Return only records whose normalized `tagCounts[tag] >= minCount` |
| `minCount` | `2` | Minimum required count, default `1` |

Success:

```json
{
  "items": [
    {
      "mediaId": "media_abc123",
      "mediaType": "image",
      "storageObject": "uploads/<ownerSub>/<mediaId>/Alectura_lathami_1.JPG",
      "status": "processed",
      "tags": ["alectura_lathami"],
      "tagCounts": {
        "alectura_lathami": 1
      },
      "modelVersion": "speciesnet-au-v1+mdv5a-v1",
      "processingError": null,
      "originalUrl": "https://...",
      "thumbnailUrl": "https://...",
      "visibility": "private",
      "allowTagEdit": false,
      "createdAt": "2026-05-24T01:00:00Z",
      "updatedAt": "2026-05-24T01:00:10Z"
    }
  ]
}
```

### `GET /media/{mediaId}`

Returns one accessible media record. Owned media is always accessible; media
owned by another user is accessible only when its `visibility` is `shared`.

### `PATCH /media/{mediaId}/sharing`

Updates owner-controlled sharing settings. Only the media owner can call this
endpoint. Shared media can be viewed by other registered users. When
`allowTagEdit` is true, other registered users can also add or remove manual
tags on that media. Delete remains owner-only.

Request:

```json
{
  "visibility": "shared",
  "allowTagEdit": true
}
```

Success:

```json
{
  "media": {
    "mediaId": "media_abc123",
    "visibility": "shared",
    "allowTagEdit": true
  }
}
```

### `POST /media/query/tags`

Runs a multi-tag AND/count query. A media record is returned only when every
requested tag is present with at least the requested count.

Tags are normalized on input and storage: trim, lowercase, spaces/hyphens to
underscores, repeated underscores collapsed.

执行多 tag AND/count 查询。只有当媒体记录满足每一个请求 tag 的最低数量时才返回。

Request:

```json
{
  "tags": {
    "dingo": 2,
    "cattle": 1
  }
}
```

Success:

```json
{
  "query": {
    "dingo": 2,
    "cattle": 1
  },
  "items": []
}
```

### `POST /media/query/file`

Runs inference on a temporary base64 image and queries existing media using the
inferred tags. The query file is not written to S3 and does not create a media
record. This endpoint accepts images only; video query-by-file is not part of
the current API contract.

对临时 base64 图片执行推理，并用识别出的 tags 查询已有媒体。query file 不会写入 S3，也不会创建媒体记录。该接口仅支持图片；当前 API contract 不包含视频 query-by-file。

Request:

```json
{
  "base64": "<base64 image bytes>"
}
```

Success:

```json
{
  "modelVersion": "speciesnet-au-v1+mdv5a-v1",
  "inferredTagCounts": {
    "alectura_lathami": 1
  },
  "query": {
    "alectura_lathami": 1
  },
  "items": []
}
```

### `POST /media/query/thumbnail`

Resolves an image thumbnail URL or thumbnail object key to the original image
URL. This endpoint is limited to image media records accessible to the
authenticated user.

把图片 thumbnail URL 或 thumbnail object key 解析为原始图片 URL。该接口只返回当前认证用户可访问的 image 记录：
自己拥有的媒体，或其他用户显式 shared 的媒体。

Request:

```json
{
  "thumbnailUrl": "https://..."
}
```

Success:

```json
{
  "mediaId": "media_abc123",
  "thumbnailUrl": "https://...",
  "originalUrl": "https://...",
  "storageObject": "uploads/<ownerSub>/<mediaId>/Alectura_lathami_1.JPG"
}
```

### `POST /media/tags/bulk`

Adds or removes manual tags on media records the caller can edit. Owners can
always edit tags. Other registered users can edit tags only when the owner has
set `visibility=shared` and `allowTagEdit=true`. The endpoint accepts `mediaIds`
and also supports URL/object references through `urls`.

对调用者有编辑权限的媒体批量添加或删除手动 tags。Owner 永远可以编辑；其他注册用户只有在 owner 设置
`visibility=shared` 且 `allowTagEdit=true` 后才能编辑。接口接受 `mediaIds`，也支持通过 `urls`
传 URL/object 引用。

Request:

```json
{
  "mediaIds": ["media_abc123"],
  "tags": ["reviewed", "demo"],
  "operation": 1
}
```

Use `operation=1` to add and `operation=0` to remove. Add is idempotent: each
listed tag is present with a count of at least `1`, but repeated add operations
do not increment the count. Remove deletes each listed tag if present and ignores
missing tags. When `operation=1` adds a tag that was not already present on a
media record, the API publishes a tag-match SNS message with `routeKey`,
`ownerSub`, and `mediaId` message attributes, so existing subscription filter
policies can deliver it only to the same user's matching subscription.

`operation=1` 表示添加，`operation=0` 表示删除。添加是幂等操作：每个 tag 至少以 count `1`
存在，但重复添加不会递增 count。删除会直接移除存在的 tag，并忽略不存在的 tag。当 `operation=1`
真正为某个媒体新增 tag 时，API 会发布带 `routeKey`、`ownerSub` 和 `mediaId`
message attributes 的 SNS 消息，让已有 subscription filter policy 只投递给同一用户的匹配订阅。

Success:

```json
{
  "updated": [
    {
      "mediaId": "media_abc123",
      "tags": ["demo", "reviewed"],
      "tagCounts": {
        "demo": 1,
        "reviewed": 1
      }
    }
  ]
}

```

### `POST /media/delete`

Bulk-deletes owned media by original/thumbnail URLs or object keys. This is the
assignment-facing delete API: clients can send a list of URLs, and the system
removes the original object, thumbnail object, and database record for every
matching owned media item.

通过原文件/缩略图 URL 或 object key 批量删除当前用户拥有的 media。这是面向作业要求的删除接口：
客户端可以发送 URL 列表，系统会删除每条匹配媒体的原文件、缩略图和数据库记录。

Request:

```json
{
  "urls": [
    "https://...",
    "thumbnails/<ownerSub>/media_abc123/thumbnail.jpg"
  ]
}
```

Success:

```json
{
  "deleted": [
    {
      "mediaId": "media_abc123",
      "storageObject": "uploads/<ownerSub>/media_abc123/Alectura_lathami_1.JPG",
      "thumbnailObject": "thumbnails/<ownerSub>/media_abc123/thumbnail.jpg",
      "deletedAt": "2026-05-24T01:05:00Z"
    }
  ],
  "count": 1
}
```

### `DELETE /media/{mediaId}`

Deletes one owned media item by internal ID. This endpoint remains available for
UI convenience; `POST /media/delete` is the bulk URL-based assignment API.

通过内部 ID 删除单条当前用户拥有的 media。该接口保留用于 UI 便利操作；`POST /media/delete`
是符合批量 URL 删除要求的作业接口。

Success:

```json
{
  "mediaId": "media_abc123",
  "deleted": true
}
```

## Subscriptions

### `POST /subscriptions`

Creates an active tag subscription record.

Request:

```json
{
  "email": "user@example.com",
  "tags": ["alectura_lathami", "felis_catus"]
}
```

Success:

```json
{
  "subscription": {
    "subscriptionId": "sub_abc123",
    "ownerSub": "<cognito-sub>",
    "email": "user@example.com",
    "tags": ["alectura_lathami", "felis_catus"],
    "active": true,
    "snsStatus": "pending_confirmation",
    "snsSubscriptionArn": "pending confirmation",
    "snsFilterPolicy": "{\"routeKey\":[\"<cognito-sub>#alectura_lathami\",\"<cognito-sub>#felis_catus\"]}",
    "createdAt": "2026-05-24T01:00:00Z",
    "updatedAt": "2026-05-24T01:00:00Z"
  }
}
```

The API also creates an SNS email subscription on the notification topic.
The SNS subscription uses a `FilterPolicy` on the `routeKey` message attribute,
where each value is `<ownerSub>#<tag>`. This lets one shared topic route each
tag-match event only to confirmed email subscriptions for the same signed-in
user and tag. The user must confirm the AWS SNS email before tag-match
notifications are delivered.

API 会同时在通知 topic 上创建 SNS email subscription，并在 `routeKey` message
attribute 上设置 SNS `FilterPolicy`。`routeKey` 的格式是
`<ownerSub>#<tag>`，因此一个共享 topic 只会把某个 tag 的通知投递给同一登录用户且订阅了
该 tag 的邮箱。用户必须在邮箱中确认 AWS SNS 邮件后，才能收到 tag 命中通知。

### `GET /subscriptions`

Lists subscriptions owned by the authenticated user.

### `DELETE /subscriptions/{subscriptionId}`

Disables an owned subscription.

Success:

```json
{
  "subscriptionId": "sub_abc123",
  "deleted": true
}
```

## Upload Processor

The S3 bucket triggers `ProcessorFunction` for `uploads/` objects. It:

1. Parses `mediaId` from `uploads/{ownerSub}/{mediaId}/{filename}`.
2. Marks the record as `processing`.
3. Calls `INFERENCE_ENDPOINT_URL/inference`.
   If `INFERENCE_API_KEY_PARAMETER_NAME` is configured, the processor reads the
   key from SSM Parameter Store with `ssm:GetParameter`; otherwise it falls back
   to the legacy `INFERENCE_API_KEY` environment variable. When a key is present,
   the processor sends it as `X-Inference-Api-Key`. If the endpoint is missing in
   deployed mode, processing fails closed and writes `processingError`.
4. For videos with a model endpoint, extracts one frame per second with
   `ffmpeg`, sends sampled frames to inference, and stores each tag count as the
   maximum count seen in any single sampled frame rather than summing detections
   across frames.
   The deployed stack sets `VIDEO_MAX_FRAMES=0`, so the full video is sampled
   at 1 fps by default. If an operator explicitly sets `VIDEO_MAX_FRAMES > 0`,
   that value becomes an emergency processing cap. `VIDEO_EXTRACTION_TIMEOUT_SECONDS`
   and `VIDEO_PROCESSING_BUDGET_SECONDS` bound extraction and total frame
   classification time.
5. Allows filename-derived demo tags only when `ALLOW_DEMO_FALLBACK=true`.
6. Creates a JPEG thumbnail for image uploads and extracts a representative
   JPEG thumbnail frame for video uploads.
7. Updates DynamoDB with `tags`, `tagCounts`, `thumbnailUrl`, `modelVersion`,
   and `status=processed`.
8. Publishes matching tag notification events to SNS.
9. Writes `status=failed` and `processingError` when processing cannot finish.

When Cloud Run inference is cold-starting, the processor waits up to
`INFERENCE_TIMEOUT_SECONDS` before recording a timeout failure. The web UI
displays `processingError` for failed media records.

Cloud Run 冷启动时，processor 会等待最多 `INFERENCE_TIMEOUT_SECONDS`；如果仍未完成，会把错误写入 `processingError`。网页会在失败媒体记录中展示该错误。

The demo fallback is disabled by default and is only for local walkthroughs or
first-pass deployment evidence when `ALLOW_DEMO_FALLBACK=true` is explicitly set.
Real submission evidence should use the model-backed inference endpoint.
Model-backed video processing also requires an ffmpeg-enabled Lambda runtime or
container image.
