# Assignment Readiness / 作业完成度检查

This document compares the current Aussie EcoLens implementation with the FIT5225 Assignment 2 requirements. It is intentionally bilingual so teammates and AI assistants can read the same source of truth.

本文档用于对照当前 Aussie EcoLens 实现与 FIT5225 Assignment 2 要求。内容采用中英双语，方便团队成员和 AI 助手共享同一份事实依据。

## Current Deployed System / 当前已部署系统

| Area | Current implementation | 当前实现 |
|---|---|---|
| Authentication | AWS Cognito user pool protects the API through API Gateway authorizer, and a Cognito PreSignUp trigger enforces email, first name, and last name on registration. | 使用 AWS Cognito 用户池，通过 API Gateway authorizer 保护 API；Cognito PreSignUp trigger 在注册时强制要求 email、first name 和 last name。 |
| Frontend | React/Vite app hosted on Google Cloud Storage. | React/Vite 前端托管在 Google Cloud Storage。 |
| API | AWS API Gateway + Python Lambda. | AWS API Gateway + Python Lambda。 |
| Storage | AWS S3 stores uploaded images, videos, and generated thumbnails. | AWS S3 保存上传的图片、视频和生成的缩略图。 |
| Metadata | AWS DynamoDB stores media records, tag counts, status, URLs, and subscriptions. | AWS DynamoDB 保存媒体记录、tag count、处理状态、URL 和订阅记录。 |
| Inference | GCP Cloud Run runs MegaDetector + SpeciesNet and is called from AWS Lambda with an API key. | GCP Cloud Run 运行 MegaDetector + SpeciesNet，由 AWS Lambda 通过 API key 调用。 |
| Notifications | AWS SNS topic receives tag-match events; subscription records are managed by the API/UI. | AWS SNS topic 接收 tag 命中事件；API/UI 管理订阅记录。 |

## Requirement Coverage / 要求覆盖情况

| Requirement | Status | Evidence in code | Notes / 说明 |
|---|---:|---|---|
| Cognito authentication | Done | `infra/aws-sam/template.yaml`, `services/aws-presignup/src/app.py`, `apps/web/src/auth/` | Users can sign up, confirm, sign in, and call protected endpoints. Cognito enforces email verification and the PreSignUp trigger rejects registrations missing email, first name, or last name. 用户可注册、确认、登录并访问受保护 API；Cognito 强制 email verification，PreSignUp trigger 会拒绝缺少 email、first name 或 last name 的注册。 |
| Multi-cloud architecture | Done | AWS backend + GCP frontend + GCP Cloud Run inference | AWS handles auth/API/storage/DB; GCP handles frontend and ML inference. AWS 负责认证/API/存储/数据库，GCP 负责前端和 ML 推理。 |
| Serverless compute | Done | API Lambda, processor Lambda, Cloud Run | Core compute is serverless/serverless-container. 核心计算为 serverless / serverless container。 |
| Fine-grained IAM | Done | `infra/aws-sam/template.yaml` | Lambda roles use explicit least-privilege S3, DynamoDB, SNS, and optional SSM actions scoped to required object prefixes, tables, indexes, topic, and parameter ARN. Processor no longer reads the subscription table or mutates SNS subscriptions. SNS subscription-attribute actions use `Resource: "*"` only where AWS does not support resource-level scoping. Lambda role 使用显式最小权限 S3、DynamoDB、SNS 和可选 SSM actions，并限制到必要 object prefix、表、索引、topic 和 parameter ARN；processor 不再读取 subscription table 或修改 SNS subscription；只有 AWS 不支持资源级限制的 SNS subscription attribute 操作保留 `Resource: "*"`。 |
| Upload images and videos | Done | `POST /media/upload-url`, S3 presigned PUT, web upload form | Browser calculates SHA-256 before requesting upload; the presigned PUT requires checksum metadata. 浏览器先计算 SHA-256 再请求上传；presigned PUT 要求携带 checksum metadata。 |
| Deduplication | Done | `DedupTable`, `ownerChecksumKey-index`, `checksumSha256`, `checksumVerifiedAt` | API requires valid SHA-256 and uses an atomic owner/checksum reservation before creating media records, so concurrent duplicate upload requests cannot create two records. Stale pending records without an S3 object are not treated as completed duplicates, and the processor recalculates the uploaded object's checksum before tagging. API 强制有效 SHA-256，并在创建媒体记录前使用原子 owner/checksum reservation，因此并发重复上传请求不能创建两条记录。没有 S3 object 的 stale pending 记录不会被当成已完成 duplicate；processor 会在 tagging 前重新计算上传对象 checksum。 |
| Storage trigger processing | Done | S3 event -> `ProcessorFunction` | Uploaded objects under `uploads/` trigger processing automatically. `uploads/` 下对象自动触发处理。 |
| ML tagging | Done | `services/inference/`, `services/aws-processor/` | Real deployed model version is `speciesnet-au-v1+mdv5a-v1`; deployed mode fails closed if `INFERENCE_ENDPOINT_URL` is missing. Filename-derived tags require explicit `ALLOW_DEMO_FALLBACK=true` and are demo-only. 当前真实模型版本为 `speciesnet-au-v1+mdv5a-v1`；部署模式如果缺少 `INFERENCE_ENDPOINT_URL` 会失败关闭。文件名 tag 必须显式设置 `ALLOW_DEMO_FALLBACK=true`，仅用于 demo。 |
| Video handling | Done | `VIDEO_FRAME_RATE=1`, `VIDEO_MAX_FRAMES=0`, `VIDEO_EXTRACTION_TIMEOUT_SECONDS=90`, `VIDEO_PROCESSING_BUDGET_SECONDS=105` | Assignment asks for 1 image/sec and not all frames. The deployment samples the full video at 1 fps by default; video `tagCounts` use the maximum count seen in any single sampled frame instead of summing detections across frames. `VIDEO_MAX_FRAMES` remains an emergency override only when set above 0, while extraction and total processing budgets prevent silent truncation or runaway Lambda work. For live demo evidence, use a 3-8 second video; very long videos can exhaust the Lambda budget and fail visibly with `processingError`. 作业要求 1fps 且不要抽全部帧；当前部署默认按整段视频 1fps 抽帧；视频 `tagCounts` 取单帧最大值，而不是跨帧累计检测次数。`VIDEO_MAX_FRAMES` 只有大于 0 时才作为应急上限，抽帧和整体处理预算防止静默截断或 Lambda 长时间失控。现场 demo 证据建议使用 3-8 秒短视频；超长视频可能耗尽 Lambda budget，并以 `processingError` 明确失败。 |
| Thumbnails | Done | `_create_thumbnail`, `_create_video_thumbnail` | Images and videos show generated thumbnails in the UI. 图片和视频均生成缩略图并在 UI 展示。 |
| Metadata schema | Mostly done | DynamoDB media item fields | Stores media type, URLs, tags, tagCounts, checksum, checksum verification time, owner, modelVersion, status, and processingError. 已保存核心字段，包括 checksum 验证时间。 |
| Query by tag and minimum count | Done | `GET /media?tag=...&minCount=...`, `POST /media/query/tags` | Single-tag and multi-tag AND/count queries are supported. 支持单 tag 查询和多 tag AND/count 查询。 |
| Query by species | Done via tag query | Same query paths | Species strings are stored as tags and can be queried through the tag endpoints. species 字符串作为 tags 存储，可通过 tag 查询接口检索。 |
| Query by uploaded file | Done for images | `POST /media/query/file` | Accepts a temporary base64 image, calls inference, and does not create a media record. Video query-by-file is out of scope for the current demo path. 接收临时 base64 图片，调用推理服务，且不创建媒体记录；当前 demo 路径不支持视频 query-by-file。 |
| Manual bulk tag add/remove | Done | `POST /media/tags/bulk` | Supports idempotent add/remove on selected owned media: add sets tag presence to at least count 1 without repeated increments, remove deletes the tag while ignoring missing tags, and newly added tags publish SNS tag-match messages. 支持对所选自有媒体进行幂等 add/remove：添加会确保 tag 至少以 count 1 存在且不会重复递增；删除会移除 tag，并忽略不存在的 tag；真正新增的 tag 会发布 SNS tag-match 消息。 |
| Delete files | Done | `POST /media/delete`, `DELETE /media/{mediaId}` | Bulk URL-based API deletes original objects, thumbnail objects, and soft-deletes DynamoDB records; single-ID delete remains for UI convenience. 支持按 URL 批量删除原文件、缩略图并软删除 DB 记录；单 ID 删除保留用于 UI 操作。 |
| Notifications | Done, needs confirmation evidence | `POST/GET/DELETE /subscriptions`, SNS email subscribe with owner/tag route filter policies, SNS publish in processor/API | Subscription records create SNS email subscriptions with `<ownerSub>#<tag>` route-key filter policies; processor publishes upload detections and API publishes newly added manual tags with matching `routeKey` message attributes. Users must confirm the AWS SNS email before delivery. 订阅记录会创建带 `<ownerSub>#<tag>` route-key 过滤策略的 SNS email subscription；processor 发布上传识别通知，API 发布手动新增 tag 通知，并带匹配的 `routeKey` message attribute；用户必须确认 AWS SNS 邮件后才能收到通知。 |
| UI coverage | Good | `apps/web/src/pages/MediaPage.tsx` | UI covers auth, upload, single/multi-tag search, query-by-file, bulk tag edit, delete, subscriptions, and status/error display. UI 覆盖认证、上传、单/多 tag 查询、query-by-file、批量 tag 编辑、删除、订阅和状态/错误。 |
| Failure visibility | Done | `processingError` in DynamoDB and web UI | Failed processing now shows a readable error in the media list. 处理失败时网页会展示可读错误。 |

## Manual Test Checklist / 人工测试清单

1. Open the public frontend: `https://storage.googleapis.com/aussie-ecolens-web-arched-vigil-490915-f7/index.html#/media`.
   打开公开前端。
2. Sign in with a Cognito user.
   使用 Cognito 用户登录。
3. Upload a new image and wait until it becomes `processed`.
   上传新图片并等待状态变为 `processed`。
4. Confirm the result shows tags and `modelVersion = speciesnet-au-v1+mdv5a-v1`.
   确认结果显示 tags，并且模型版本为 `speciesnet-au-v1+mdv5a-v1`。
5. Upload a 3-8 second short video and refresh until it becomes `processed`.
   Very long videos may fail visibly because the Lambda processing budget is
   bounded.
   上传 3-8 秒短视频并刷新直到状态变为 `processed`。超长视频可能因为
   Lambda processing budget 有上限而明确失败。
6. Search by a returned tag and confirm the media item is returned.
   使用返回的 tag 搜索并确认能查回该媒体。
7. Delete a media item and confirm it disappears from the list.
   删除一条媒体并确认列表中消失。
8. Create and remove a subscription record.
   创建并删除订阅记录。
9. If a media item fails, confirm the UI shows `Error: ...`.
   如果处理失败，确认 UI 显示 `Error: ...`。

## Evidence To Capture / 需要截图或保存的证据

- Cognito user pool and successful login screen.
  Cognito 用户池和成功登录界面。
- S3 bucket with uploaded media and generated thumbnails.
  S3 bucket 中的上传文件和缩略图。
- DynamoDB media record showing `tagCounts`, `modelVersion`, `status`, and URLs.
  DynamoDB 媒体记录，包含 `tagCounts`、`modelVersion`、`status` 和 URL。
- Cloud Run logs showing model startup and `/inference` `200 OK`.
  Cloud Run 日志，显示模型启动和 `/inference` `200 OK`。
- Lambda CloudWatch logs showing processor execution.
  Lambda CloudWatch 日志，显示 processor 执行。
- UI screenshots for image upload, video upload, tag search, delete, and subscriptions.
  UI 截图：图片上传、视频上传、tag 查询、删除和订阅。

## Recommended Remaining Work / 建议剩余工作

1. Capture email notification evidence after confirming the SNS email subscription.
   确认 SNS email subscription 后，补充邮件通知证据。
2. Add focused automated tests for API query semantics and processor failure handling.
   为 API 查询语义和 processor 失败处理添加测试。

## Non-Requirement Clarification / 非硬性要求说明

Real-time bounding boxes during video playback are not listed as a required feature in the extracted assignment text. The requirement is to sample video frames, run image detection/classification, aggregate tags/counts, and return the full video URL in query results.

播放视频时实时显示检测框不在已提取的作业硬性要求中。作业要求是对视频抽帧、按图片进行检测/分类、汇总 tags/counts，并在查询结果中返回完整视频 URL。
