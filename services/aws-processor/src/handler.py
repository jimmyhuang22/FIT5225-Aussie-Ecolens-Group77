from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import boto3
from botocore.exceptions import ClientError

MEDIA_BUCKET = os.environ["MEDIA_BUCKET"]
MEDIA_TABLE = os.environ["MEDIA_TABLE"]
DEDUP_TABLE = os.environ.get("DEDUP_TABLE", "")
NOTIFICATION_TOPIC_ARN = os.environ["NOTIFICATION_TOPIC_ARN"]
INFERENCE_ENDPOINT_URL = os.environ.get("INFERENCE_ENDPOINT_URL", "").rstrip("/")
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")
INFERENCE_API_KEY_PARAMETER_NAME = os.environ.get(
    "INFERENCE_API_KEY_PARAMETER_NAME", ""
)
INFERENCE_TOP_K = int(os.environ.get("INFERENCE_TOP_K", "3"))
INFERENCE_TIMEOUT_SECONDS = int(os.environ.get("INFERENCE_TIMEOUT_SECONDS", "90"))
ALLOW_DEMO_FALLBACK = os.environ.get("ALLOW_DEMO_FALLBACK", "false").lower() == "true"
MODEL_VERSION = os.environ.get("MODEL_VERSION", "aws-demo-adapter-v1")
VIDEO_FRAME_RATE = int(os.environ.get("VIDEO_FRAME_RATE", "1"))
VIDEO_MAX_FRAMES = int(os.environ.get("VIDEO_MAX_FRAMES", "0"))
VIDEO_EXTRACTION_TIMEOUT_SECONDS = int(
    os.environ.get("VIDEO_EXTRACTION_TIMEOUT_SECONDS", "90")
)
VIDEO_PROCESSING_BUDGET_SECONDS = int(
    os.environ.get("VIDEO_PROCESSING_BUDGET_SECONDS", "105")
)

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
sns = boto3.client("sns")
ssm = boto3.client("ssm") if INFERENCE_API_KEY_PARAMETER_NAME else None
media_table = dynamodb.Table(MEDIA_TABLE)
dedup_table = dynamodb.Table(DEDUP_TABLE) if DEDUP_TABLE else None
_cached_inference_api_key: str | None = None


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    processed: list[str] = []
    failed: list[str] = []
    for record in event.get("Records", []):
        bucket = record.get("s3", {}).get("bucket", {}).get("name")
        key = urllib.parse.unquote_plus(record.get("s3", {}).get("object", {}).get("key", ""))
        if bucket != MEDIA_BUCKET or not key.startswith("uploads/"):
            continue
        media_id = _media_id_from_key(key)
        if not media_id:
            continue
        try:
            if _process_object(bucket, key, media_id):
                processed.append(media_id)
        except Exception as exc:
            LOG.exception("Failed to process media_id=%s key=%s", media_id, key)
            _mark_failed(media_id, exc)
            failed.append(media_id)
    return {"processed": processed, "failed": failed}


def _process_object(bucket: str, key: str, media_id: str) -> bool:
    media = _get_media(media_id)
    if not media or media.get("deletedAt"):
        return False

    now = _now()
    media_table.update_item(
        Key={"mediaId": media_id},
        UpdateExpression="SET #s = :status, updatedAt = :updatedAt REMOVE processingError",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":status": "processing", ":updatedAt": now},
    )
    _sync_dedup_status_for_media(media, "processing")

    checksum_verified_at = _verify_uploaded_checksum(bucket, key, media)
    media_type = media.get("mediaType") or _infer_media_type(key)
    tag_counts, model_version = _detect_tags(bucket, key, media_type, media)
    tags = sorted(tag_counts)
    original_url = _presigned_get_url(bucket, key)
    thumbnail_object, thumbnail_url = _create_thumbnail(bucket, key, media)
    now = _now()

    media_table.update_item(
        Key={"mediaId": media_id},
        UpdateExpression=(
            "SET originalUrl = :originalUrl, thumbnailUrl = :thumbnailUrl, "
            "thumbnailObject = :thumbnailObject, tags = :tags, tagCounts = :tagCounts, "
            "modelVersion = :modelVersion, checksumVerifiedAt = :checksumVerifiedAt, "
            "updatedAt = :updatedAt, #s = :status"
        ),
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":originalUrl": original_url,
            ":thumbnailUrl": thumbnail_url,
            ":thumbnailObject": thumbnail_object,
            ":tags": tags,
            ":tagCounts": tag_counts,
            ":modelVersion": model_version,
            ":checksumVerifiedAt": checksum_verified_at,
            ":updatedAt": now,
            ":status": "processed",
        },
    )
    _sync_dedup_status_for_media(media, "processed")
    _notify_matching_subscriptions(media, tags, tag_counts)
    return True


def _media_id_from_key(key: str) -> str | None:
    parts = key.split("/")
    if len(parts) < 4:
        return None
    return parts[2]


def _get_media(media_id: str) -> dict[str, Any] | None:
    result = media_table.get_item(Key={"mediaId": media_id})
    return result.get("Item")


def _verify_uploaded_checksum(bucket: str, key: str, media: dict[str, Any]) -> str:
    expected = str(media.get("checksumSha256") or "").strip().lower()
    if not _is_sha256_hex(expected):
        raise RuntimeError("missing or invalid checksumSha256 on media record")

    head = s3.head_object(Bucket=bucket, Key=key)
    metadata = head.get("Metadata") or {}
    metadata_checksum = str(metadata.get("checksum-sha256") or "").strip().lower()
    if metadata_checksum != expected:
        raise RuntimeError(
            "S3 object checksum metadata mismatch: "
            f"expected {expected}, got {metadata_checksum or 'missing'}"
        )

    actual = _s3_object_sha256(bucket, key)
    if actual != expected:
        raise RuntimeError(f"uploaded file checksum mismatch: expected {expected}, got {actual}")
    return _now()


def _is_sha256_hex(value: str) -> bool:
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _s3_object_sha256(bucket: str, key: str) -> str:
    body = s3.get_object(Bucket=bucket, Key=key)["Body"]
    hasher = hashlib.sha256()
    try:
        while True:
            chunk = body.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    finally:
        close = getattr(body, "close", None)
        if callable(close):
            close()
    return hasher.hexdigest()


def _detect_tags(
    bucket: str, key: str, media_type: str, media: dict[str, Any]
) -> tuple[dict[str, int], str]:
    if INFERENCE_ENDPOINT_URL:
        if media_type == "video":
            return _detect_video_tags(bucket, key, media)
        inference = _call_inference(_presigned_get_url(bucket, key, expires=900))
        return _counts_from_inference(inference), str(
            inference.get("model_version") or MODEL_VERSION
        )

    if not ALLOW_DEMO_FALLBACK:
        raise RuntimeError("INFERENCE_ENDPOINT_URL is required in deployed mode")
    return _filename_demo_tags(key), MODEL_VERSION


def _filename_demo_tags(key: str) -> dict[str, int]:
    filename = key.rsplit("/", 1)[-1]
    stem = filename.rsplit(".", 1)[0]
    match = re.match(r"([A-Z][a-z]+_[a-z]+)", stem)
    tag = _normalize_tag(match.group(1) if match else "unknown_species")
    return {tag: 1}


def _detect_video_tags(
    bucket: str, key: str, media: dict[str, Any]
) -> tuple[dict[str, int], str]:
    ffmpeg = _ffmpeg_executable()
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for model-backed video processing")

    deadline = time.monotonic() + VIDEO_PROCESSING_BUDGET_SECONDS
    model_version = MODEL_VERSION
    max_counts: dict[str, int] = {}
    with TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        source = tmp / "source"
        frame_dir = tmp / "frames"
        frame_dir.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, key, str(source))
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vf",
            f"fps={VIDEO_FRAME_RATE}",
        ]
        if VIDEO_MAX_FRAMES > 0:
            command.extend(["-frames:v", str(VIDEO_MAX_FRAMES)])
        command.append(str(frame_dir / "frame_%05d.jpg"))
        extraction_timeout = _remaining_video_seconds(
            deadline, limit=VIDEO_EXTRACTION_TIMEOUT_SECONDS
        )
        subprocess.run(
            command,
            check=True,
            timeout=extraction_timeout,
        )
        frame_paths = sorted(frame_dir.glob("frame_*.jpg"))
        if not frame_paths:
            raise RuntimeError("video produced no frames")
        for frame_path in frame_paths:
            remaining = _remaining_video_seconds(
                deadline, limit=INFERENCE_TIMEOUT_SECONDS
            )
            inference = _call_inference_base64(frame_path, timeout_seconds=remaining)
            frame_counts = _counts_from_inference(inference)
            for tag, count in frame_counts.items():
                max_counts[tag] = max(max_counts.get(tag, 0), count)
            model_version = str(inference.get("model_version") or model_version)
    return max_counts, model_version


def _call_inference(image_url: str) -> dict[str, Any]:
    return _post_inference({"url": image_url})


def _call_inference_base64(
    image_path: Path, timeout_seconds: int | None = None
) -> dict[str, Any]:
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return _post_inference({"base64": encoded}, timeout_seconds=timeout_seconds)


def _post_inference(
    image: dict[str, str], timeout_seconds: int | None = None
) -> dict[str, Any]:
    payload = json.dumps({"image": image, "top_k": INFERENCE_TOP_K}).encode()
    request = urllib.request.Request(
        f"{INFERENCE_ENDPOINT_URL}/inference",
        data=payload,
        headers=_inference_headers(),
        method="POST",
    )
    timeout = timeout_seconds or INFERENCE_TIMEOUT_SECONDS
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError(
            "Inference request timed out after "
            f"{timeout}s. Cloud Run may still be cold-starting; "
            "retry this media or use a shorter video."
        ) from exc


def _inference_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    api_key = _inference_api_key()
    if api_key:
        headers["X-Inference-Api-Key"] = api_key
    return headers


def _inference_api_key() -> str:
    global _cached_inference_api_key
    if not INFERENCE_API_KEY_PARAMETER_NAME:
        return INFERENCE_API_KEY
    if _cached_inference_api_key is None:
        if ssm is None:
            raise RuntimeError("SSM client is not configured")
        result = ssm.get_parameter(
            Name=INFERENCE_API_KEY_PARAMETER_NAME,
            WithDecryption=True,
        )
        _cached_inference_api_key = str(result.get("Parameter", {}).get("Value") or "")
    return _cached_inference_api_key


def _ffmpeg_executable() -> str | None:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def _remaining_video_seconds(deadline: float, limit: int | None = None) -> int:
    remaining = int(deadline - time.monotonic())
    if remaining <= 5:
        raise RuntimeError(
            "Video processing budget exhausted before all 1fps frames could be "
            "classified; use a shorter video or increase VIDEO_PROCESSING_BUDGET_SECONDS."
        )
    budget = remaining - 5
    return min(limit, budget) if limit is not None else budget


def _counts_from_inference(inference: dict[str, Any]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for detection in inference.get("detections", []):
        predictions = detection.get("predictions") or []
        if not predictions:
            continue
        best = predictions[0]
        species = best.get("species")
        common_name = best.get("common_name")
        if species:
            tag = _normalize_tag(species)
            if tag:
                counts[tag] += 1
        if common_name:
            tag = _normalize_tag(common_name)
            if tag:
                counts[tag] += 1
    return dict(counts)


def _normalize_tag(raw: Any) -> str:
    tag = re.sub(r"[\s-]+", "_", str(raw or "").strip().lower())
    tag = re.sub(r"_+", "_", tag)
    return tag.strip("_")


def _create_thumbnail(
    bucket: str, key: str, media: dict[str, Any]
) -> tuple[str | None, str | None]:
    if media.get("mediaType") == "video":
        return _create_video_thumbnail(bucket, key, media)
    if media.get("mediaType") != "image":
        return None, None
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required for image thumbnail generation") from exc

    owner_sub = media.get("ownerSub") or "unknown-owner"
    media_id = media.get("mediaId") or _media_id_from_key(key) or "unknown-media"
    thumbnail_key = f"thumbnails/{owner_sub}/{media_id}/thumbnail.jpg"
    with TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        source = tmp / "source"
        thumbnail = tmp / "thumbnail.jpg"
        s3.download_file(bucket, key, str(source))
        with Image.open(source) as image:
            image.thumbnail((360, 360))
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            image.save(thumbnail, format="JPEG", quality=82, optimize=True)
        s3.upload_file(
            str(thumbnail),
            bucket,
            thumbnail_key,
            ExtraArgs={"ContentType": "image/jpeg"},
        )
    return thumbnail_key, _presigned_get_url(bucket, thumbnail_key)


def _create_video_thumbnail(
    bucket: str, key: str, media: dict[str, Any]
) -> tuple[str | None, str | None]:
    ffmpeg = _ffmpeg_executable()
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for video thumbnail generation")

    owner_sub = media.get("ownerSub") or "unknown-owner"
    media_id = media.get("mediaId") or _media_id_from_key(key) or "unknown-media"
    thumbnail_key = f"thumbnails/{owner_sub}/{media_id}/thumbnail.jpg"
    with TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        source = tmp / "source"
        thumbnail = tmp / "thumbnail.jpg"
        s3.download_file(bucket, key, str(source))
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-ss",
                "00:00:01",
                "-frames:v",
                "1",
                "-vf",
                "scale='min(360,iw)':-2",
                "-q:v",
                "3",
                str(thumbnail),
            ],
            check=True,
            timeout=60,
        )
        if not thumbnail.exists():
            raise RuntimeError("video thumbnail frame was not generated")
        s3.upload_file(
            str(thumbnail),
            bucket,
            thumbnail_key,
            ExtraArgs={"ContentType": "image/jpeg"},
        )
    return thumbnail_key, _presigned_get_url(bucket, thumbnail_key)


def _presigned_get_url(bucket: str, key: str, expires: int = 3600) -> str:
    return s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def _infer_media_type(key: str) -> str:
    filename = key.rsplit("/", 1)[-1].lower()
    return "video" if filename.endswith((".mp4", ".mov", ".avi", ".mkv", ".webm")) else "image"


def _mark_failed(media_id: str, exc: Exception) -> None:
    media_table.update_item(
        Key={"mediaId": media_id},
        UpdateExpression="SET #s = :status, processingError = :error, updatedAt = :updatedAt",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":status": "failed",
            ":error": str(exc)[:500],
            ":updatedAt": _now(),
        },
    )
    media = _get_media(media_id)
    if media:
        _sync_dedup_status_for_media(media, "failed")


def _sync_dedup_status_for_media(item: dict[str, Any], status: str) -> None:
    owner_checksum_key = str(item.get("ownerChecksumKey") or "")
    media_id = str(item.get("mediaId") or "")
    if dedup_table is None or not owner_checksum_key or not media_id:
        return
    update_expression = "SET mediaId = :mediaId, #s = :status, updatedAt = :updatedAt"
    values: dict[str, Any] = {
        ":mediaId": media_id,
        ":status": status,
        ":updatedAt": _now(),
    }
    if status == "failed":
        update_expression += ", expiresAt = :expiresAt"
        values[":expiresAt"] = int(time.time())
    else:
        update_expression += " REMOVE expiresAt"
    try:
        dedup_table.update_item(
            Key={"ownerChecksumKey": owner_checksum_key},
            UpdateExpression=update_expression,
            ConditionExpression="attribute_not_exists(mediaId) OR mediaId = :mediaId",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _notify_matching_subscriptions(
    media: dict[str, Any], tags: list[str], tag_counts: dict[str, int]
) -> None:
    if not tags:
        return
    owner = media.get("ownerSub", "unknown user")
    media_id = media.get("mediaId", "unknown media")
    for tag in sorted({tag for tag in tags if tag}):
        message = {
            "event": "tag_detected",
            "mediaId": media_id,
            "ownerSub": owner,
            "matchedTags": [tag],
            "tagCounts": tag_counts,
        }
        sns.publish(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Subject=f"Aussie EcoLens tag detected: {tag}",
            Message=json.dumps(message, indent=2),
            MessageAttributes={
                "ownerSub": {"DataType": "String", "StringValue": owner},
                "routeKey": {
                    "DataType": "String",
                    "StringValue": _notification_route_key(owner, tag),
                },
                "mediaId": {"DataType": "String", "StringValue": media_id},
            },
        )


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _notification_route_key(owner_sub: str, tag: str) -> str:
    clean_owner = str(owner_sub or "").strip()
    clean_tag = _normalize_tag(tag)
    if not clean_owner or not clean_tag:
        return ""
    return f"{clean_owner}#{clean_tag}"
