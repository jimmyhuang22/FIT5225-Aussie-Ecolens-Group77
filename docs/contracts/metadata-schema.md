# Metadata Schema Contract / 元数据契约

## Current Store / 当前存储

The current implementation stores metadata in AWS DynamoDB tables created by `infra/aws-sam/template.yaml`. The schema is still provider-neutral enough to map to Firestore or another document/key-value store later.

当前实现使用 `infra/aws-sam/template.yaml` 创建的 AWS DynamoDB 表保存元数据。该 schema 仍然足够通用，后续可迁移到 Firestore 或其他文档/键值数据库。

## Table: Media Items / 媒体表

Each uploaded image or video has one media item record.

每个上传的图片或视频对应一条媒体记录。

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `mediaId` | string | Yes | Stable internal ID for the media item |
| `ownerSub` | string | Yes | Cognito `sub` claim for the uploader/owner |
| `originalUrl` | string | Yes | URL or signed URL target for original image/video |
| `thumbnailUrl` | string or null | Images yes, videos optional | Thumbnail URL for image preview and thumbnail lookup |
| `mediaType` | string enum | Yes | `image` or `video` |
| `checksumSha256` | string | Yes | Required 64-character SHA-256 hex digest used for duplicate detection |
| `checksumVerifiedAt` | timestamp or null | No | Set by the processor after recalculating the uploaded S3 object checksum and matching it to `checksumSha256` |
| `tags` | string array | Yes | Unique normalized species/common tag names detected or manually added |
| `tagCounts` | map<string, number> | Yes | Normalized species/tag count map for minimum-count AND queries |
| `modelVersion` | string | Yes | Model version used to produce automatic tags |
| `storageProvider` | string | Yes | `gcp-storage`, `s3`, or later provider name |
| `storageObject` | string | Yes | Bucket object path/key for original media |
| `thumbnailObject` | string or null | No | Bucket object path/key for thumbnail |
| `processingError` | string or null | No | Human-readable failure reason when `status=failed` |
| `status` | string | Yes | `upload_url_issued`, `uploaded`, `processing`, `processed`, `failed`, or `deleted` |
| `createdAt` | timestamp | Yes | Upload/record creation time |
| `updatedAt` | timestamp | Yes | Last metadata/tag update time |
| `deletedAt` | timestamp or null | No | Optional soft-delete marker if used |

Example:

```json
{
  "mediaId": "media_20260520_001",
  "ownerSub": "cognito-sub-placeholder",
  "originalUrl": "https://s3-presigned.example/original",
  "thumbnailUrl": "https://s3-presigned.example/thumbnail",
  "mediaType": "image",
  "checksumSha256": "sha256-placeholder",
  "checksumVerifiedAt": "2026-05-20T00:00:10Z",
  "tags": ["alectura_lathami", "australian_brushturkey"],
  "tagCounts": {
    "alectura_lathami": 1,
    "australian_brushturkey": 1
  },
  "modelVersion": "speciesnet-au-v1+mdv5a-v1",
  "storageProvider": "s3",
  "storageBucket": "aussie-ecolens-900069969009-ap-southeast-2-media",
  "storageObject": "uploads/<ownerSub>/<mediaId>/Alectura_lathami_1.JPG",
  "thumbnailObject": "thumbnails/<ownerSub>/<mediaId>/thumbnail.jpg",
  "processingError": null,
  "status": "processed",
  "createdAt": "2026-05-20T00:00:00Z",
  "updatedAt": "2026-05-20T00:00:00Z",
  "deletedAt": null
}
```

## Table: Tag Subscriptions / Tag 订阅表

Stores tag subscription preferences used by the notification workflow.

保存通知流程使用的 tag 订阅偏好。

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `subscriptionId` | string | Yes | Stable subscription ID |
| `ownerSub` | string | Yes | Cognito `sub` claim for subscriber |
| `email` | string | Yes | Notification target email |
| `tags` | string array | Yes | Species/tags the user wants updates for |
| `createdAt` | timestamp | Yes | Subscription creation time |
| `updatedAt` | timestamp | Yes | Last subscription update time |
| `active` | boolean | Yes | Whether notification is active |

## Query Design Notes

### Checksum Deduplication

Before creating a new `media_items` record, the API requires a valid 64-character `checksumSha256` and atomically reserves `ownerSub#checksumSha256` in `DedupTable`. This reservation is the concurrency guard; the `ownerChecksumKey-index` remains a lookup path for existing records and migration compatibility. Completed duplicates return the existing `mediaId`/URLs and do not create duplicate records. Pending reservations can reissue an upload URL for the same media record, while stale pending records without an S3 object are not treated as completed duplicates. The presigned S3 PUT also requires `x-amz-meta-checksum-sha256`, and the processor recalculates the uploaded object's SHA-256 before tagging. If the calculated checksum, metadata checksum, and DynamoDB checksum do not match, processing is marked `failed`.

### Thumbnail URL To Full Image URL

Lookup condition:

```text
mediaType == "image" AND thumbnailUrl == requestedThumbnailUrl
```

Return `originalUrl` for the matching document.

### Species Search

Lookup condition:

```text
tags contains requested species
```

Return image `thumbnailUrl` values and video `originalUrl` values.

### Tag Minimum Count Query

Input example:

```json
{
  "alectura_lathami": 1,
  "felis_catus": 2
}
```

Required semantics: AND semantics across every requested tag. A media item matches only if:

```text
media.tagCounts["alectura_lathami"] >= 1
AND
media.tagCounts["felis_catus"] >= 2
```

This is not an OR query.

Tag keys are normalized before storage and query matching: trim, lowercase, turn
spaces/hyphens into underscores, collapse repeated underscores, and trim leading
or trailing underscores. Query matching also normalizes legacy mixed-case
`tagCounts` keys at read time for backwards compatibility.

### Query-By-File

The temporary query file may be uploaded to temporary storage or processed in memory, but it must not create a `media_items` record. Its detected `tagCounts` are used only to search existing media.

### Manual Tag Add/Remove

Manual tag operations update both `tags` and `tagCounts` consistently:

- Add: idempotently set each tag count to at least `1`; repeated adds do not increment.
- Remove: delete the tag/count if present; missing tags are ignored.
- Remove absent tag: ignore safely.

### Delete

Delete must remove or mark all linked resources consistently:

- original object at `storageObject`
- thumbnail object at `thumbnailObject`
- `media_items` document or active record status
