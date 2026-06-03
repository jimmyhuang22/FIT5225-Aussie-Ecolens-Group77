# Aussie EcoLens Service Map / 服务地图

This file describes the current deployed architecture. It replaces the earlier Firestore-first/GCP-main-runtime plan with the implemented AWS serverless backend plus GCP inference/frontend split.

本文档描述当前已部署架构，并替代早期的 Firestore-first / GCP 主运行时方案。当前实现是 AWS serverless 后端 + GCP 推理与前端。

## End-To-End Flow / 端到端流程

```text
React/Vite Web UI on Google Cloud Storage
  -> AWS Cognito sign-up/sign-in
  -> API Gateway Cognito authorizer
  -> AWS Lambda API
  -> S3 presigned upload URL
  -> S3 uploads bucket
  -> S3 ObjectCreated event
  -> AWS Lambda processor
  -> GCP Cloud Run inference service
       MegaDetector + SpeciesNet
  -> DynamoDB media metadata and tag subscriptions
  -> SNS tag-match notification topic
  -> React UI search/delete/subscription views
```

中文流程：

```text
Google Cloud Storage 上的 React/Vite 前端
  -> AWS Cognito 注册/登录
  -> API Gateway Cognito authorizer
  -> AWS Lambda API
  -> S3 presigned upload URL
  -> S3 上传 bucket
  -> S3 ObjectCreated 事件
  -> AWS Lambda processor
  -> GCP Cloud Run 推理服务
       MegaDetector + SpeciesNet
  -> DynamoDB 媒体元数据与 tag 订阅
  -> SNS tag 命中通知 topic
  -> React UI 查询/删除/订阅界面
```

## Runtime Responsibilities / 运行职责

| Service | Cloud | Runtime role | Evidence to capture | 中文说明 |
|---|---|---|---|---|
| React/Vite frontend | GCP | Public web UI hosted from Cloud Storage | Public URL screenshot, upload/search UI screenshots | 公开 Web UI，托管在 Cloud Storage |
| AWS Cognito User Pool | AWS | Sign-up, confirmation, sign-in, JWT identity, PreSignUp profile enforcement | User pool, app client, trigger, test user screenshots | 用户注册、确认、登录、JWT 身份和 PreSignUp 用户资料校验 |
| API Gateway | AWS | Protected REST entry point with Cognito authorizer | Stage URL and authorizer configuration | 受 Cognito authorizer 保护的 REST 入口 |
| API Lambda | AWS | Upload URL, media list/get/delete, subscriptions | CloudWatch logs and API responses | 上传 URL、媒体列表/详情/删除、订阅 API |
| S3 media bucket | AWS | Original images/videos and generated thumbnails | Bucket object screenshots | 保存原始图片/视频和缩略图 |
| Processor Lambda | AWS | S3 event processing, thumbnails, video frames, frame-max tag aggregation, SNS publish | CloudWatch logs and DynamoDB records | S3 事件处理、缩略图、视频抽帧、按单帧最大值汇总 tag、SNS 发布 |
| DynamoDB media table | AWS | Media metadata, status, tagCounts, checksum, modelVersion, processingError | Media record screenshots | 媒体元数据、状态、tagCounts、checksum、模型版本、错误 |
| DynamoDB subscription table | AWS | Tag subscription preferences | Subscription record screenshots | tag 订阅偏好 |
| SNS topic | AWS | Publishes tag-match notification events | Topic and publish evidence | 发布 tag 命中通知事件 |
| Cloud Run inference | GCP | MegaDetector + SpeciesNet HTTP inference service | Startup logs, `/health`, `/inference` evidence | MegaDetector + SpeciesNet HTTP 推理服务 |
| GCS model bucket | GCP | Stores model weights and labels used by Cloud Run | Bucket screenshot with `v1/` objects | 保存 Cloud Run 使用的模型权重和 labels |

## Why Both Clouds Are Meaningful / 为什么两个云都有真实作用

AWS is not decorative: Cognito is mandatory for authentication, and AWS also hosts the protected API, storage trigger, media bucket, metadata tables, and notification topic.

AWS 不是装饰性使用：Cognito 是作业强制认证要求，同时 AWS 还承载受保护 API、存储触发器、媒体 bucket、元数据表和通知 topic。

GCP is not decorative: Cloud Run hosts the actual ML inference service using the supplied model assets, and Cloud Storage hosts the public frontend. The upload-processing path crosses cloud boundaries when AWS Lambda calls GCP Cloud Run.

GCP 也不是装饰性使用：Cloud Run 承载使用给定模型资产的真实 ML 推理服务，Cloud Storage 承载公开前端。上传处理流程中 AWS Lambda 会跨云调用 GCP Cloud Run。

## Implemented Media Record Contract / 已实现媒体记录契约

The processor stores these fields in DynamoDB:

Processor 会在 DynamoDB 中保存以下字段：

- `mediaId`
- `ownerSub`
- `mediaType`
- `storageBucket`
- `storageObject`
- `thumbnailObject`
- `originalUrl`
- `thumbnailUrl`
- `checksumSha256`
- `ownerChecksumKey`
- `tags`
- `tagCounts`
- `modelVersion`
- `status`
- `processingError` when failed / 失败时写入
- `createdAt`
- `updatedAt`
- `deletedAt`

## Video Processing Note / 视频处理说明

The assignment asks for video files to be handled by extracting frames as images, using one image per second, and not extracting all frames. The deployed processor uses `VIDEO_FRAME_RATE=1` and `VIDEO_MAX_FRAMES=0`, so it samples the full video at 1 fps by default. Video `tagCounts` are aggregated by taking the maximum count observed in any single sampled frame for each tag, not by summing detections across frames.

作业要求视频通过抽帧当作图片处理，抽帧频率为每秒一张，并且不要抽取所有帧。当前部署使用 `VIDEO_FRAME_RATE=1` 和 `VIDEO_MAX_FRAMES=0`，默认按整段视频 1fps 抽帧。视频 `tagCounts` 对每个 tag 取所有抽样帧里的单帧最大值，而不是跨帧累计检测次数。

`VIDEO_MAX_FRAMES` remains as an explicit emergency override: if set above 0, the processor will cap extracted frames; otherwise no artificial frame cap is applied. `VIDEO_EXTRACTION_TIMEOUT_SECONDS` controls ffmpeg extraction timeout, and `VIDEO_PROCESSING_BUDGET_SECONDS` bounds total frame classification time, so oversized videos fail visibly instead of being silently truncated.

`VIDEO_MAX_FRAMES` 仍保留为显式应急开关：如果设置为大于 0，processor 会限制抽帧数；否则不设置人为帧数上限。`VIDEO_EXTRACTION_TIMEOUT_SECONDS` 控制 ffmpeg 抽帧超时，`VIDEO_PROCESSING_BUDGET_SECONDS` 限制总帧分类时间，因此超大视频会明确失败，而不是静默截断。

For live marking demos, use a 3-8 second video clip. Longer videos are acceptable
for failure-path evidence, but they may exhaust the Lambda processing budget and
show `processingError` in the UI.

现场评分 demo 建议使用 3-8 秒短视频。更长视频可以用于展示失败路径，但可能耗尽
Lambda processing budget，并在 UI 中显示 `processingError`。

## Remaining Evidence Gap / 剩余证据缺口

- End-user email notification delivery evidence still needs to be captured after deployment with confirmed SNS email subscriptions.
  部署后仍需用已确认的 SNS 邮件订阅补齐最终用户 email 通知投递证据。
