from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import socket
import time
import urllib.parse
import urllib.request
import uuid
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

MEDIA_BUCKET = os.environ["MEDIA_BUCKET"]
MEDIA_TABLE = os.environ["MEDIA_TABLE"]
SUBSCRIPTION_TABLE = os.environ["SUBSCRIPTION_TABLE"]
DEDUP_TABLE = os.environ.get("DEDUP_TABLE", "")
NOTIFICATION_TOPIC_ARN = os.environ.get("NOTIFICATION_TOPIC_ARN", "")
CORS_ALLOWED_ORIGIN = os.environ.get("CORS_ALLOWED_ORIGIN", "*")
PRESIGNED_URL_TTL_SECONDS = int(os.environ.get("PRESIGNED_URL_TTL_SECONDS", "900"))
DEDUP_RESERVATION_TTL_SECONDS = int(
    os.environ.get("DEDUP_RESERVATION_TTL_SECONDS", str(PRESIGNED_URL_TTL_SECONDS))
)
INFERENCE_ENDPOINT_URL = os.environ.get("INFERENCE_ENDPOINT_URL", "").rstrip("/")
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")
INFERENCE_API_KEY_PARAMETER_NAME = os.environ.get(
    "INFERENCE_API_KEY_PARAMETER_NAME", ""
)
INFERENCE_TOP_K = int(os.environ.get("INFERENCE_TOP_K", "3"))
INFERENCE_TIMEOUT_SECONDS = int(os.environ.get("INFERENCE_TIMEOUT_SECONDS", "90"))
MAX_QUERY_FILE_BYTES = int(os.environ.get("MAX_QUERY_FILE_BYTES", str(6 * 1024 * 1024)))

LOG = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
sns = boto3.client("sns")
ssm = boto3.client("ssm") if INFERENCE_API_KEY_PARAMETER_NAME else None
media_table = dynamodb.Table(MEDIA_TABLE)
subscription_table = dynamodb.Table(SUBSCRIPTION_TABLE)
dedup_table = dynamodb.Table(DEDUP_TABLE) if DEDUP_TABLE else None
_cached_inference_api_key: str | None = None


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    method = event.get("httpMethod", "GET")
    path = event.get("path", "/").rstrip("/") or "/"

    try:
        if method == "OPTIONS":
            return _response(204, {})
        if method == "GET" and path == "/api/me":
            return _response(200, {"user": _current_user(event)})
        if method == "POST" and path == "/media/upload-url":
            return _create_upload_url(event)
        if method == "POST" and path.startswith("/media/") and path.endswith("/complete"):
            media_id = path.split("/")[2]
            return _complete_upload(event, media_id)
        if method == "GET" and path == "/media":
            return _list_media(event)
        if method == "POST" and path == "/media/query/tags":
            return _query_media_by_tags(event)
        if method == "POST" and path == "/media/query/file":
            return _query_media_by_file(event)
        if method == "POST" and path == "/media/query/thumbnail":
            return _query_original_by_thumbnail(event)
        if method == "POST" and path == "/media/tags/bulk":
            return _bulk_update_tags(event)
        if method == "POST" and path == "/media/delete":
            return _bulk_delete_media(event)
        if method == "GET" and path.startswith("/media/"):
            return _get_media(event, path.split("/")[2])
        if method == "DELETE" and path.startswith("/media/"):
            return _delete_media(event, path.split("/")[2])
        if method == "POST" and path == "/subscriptions":
            return _create_subscription(event)
        if method == "GET" and path == "/subscriptions":
            return _list_subscriptions(event)
        if method == "DELETE" and path.startswith("/subscriptions/"):
            return _delete_subscription(event, path.split("/")[2])
        return _response(404, {"error": "not_found"})
    except json.JSONDecodeError:
        return _response(
            400,
            {"error": "bad_request", "message": "invalid JSON body"},
        )
    except ValueError as exc:
        return _response(400, {"error": "bad_request", "message": str(exc)})
    except PermissionError:
        return _response(403, {"error": "forbidden"})
    except ClientError:
        LOG.exception("AWS client error while handling %s %s", method, path)
        return _response(500, {"error": "aws_error"})
    except Exception:
        LOG.exception("Unexpected API error while handling %s %s", method, path)
        return _response(500, {"error": "internal_error"})


def _current_user(event: dict[str, Any]) -> dict[str, Any]:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return {
        "sub": claims.get("sub"),
        "username": claims.get("cognito:username") or claims.get("username"),
        "email": claims.get("email"),
        "given_name": claims.get("given_name"),
        "family_name": claims.get("family_name"),
        "token_use": claims.get("token_use"),
    }


def _owner_sub(event: dict[str, Any]) -> str:
    sub = _current_user(event).get("sub")
    if not sub:
        raise PermissionError()
    return sub


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object")
    return data


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _epoch_now() -> int:
    return int(time.time())


def _create_upload_url(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    body = _body(event)
    filename = str(body.get("filename") or "").strip()
    content_type = str(body.get("contentType") or "application/octet-stream")
    media_type = str(body.get("mediaType") or _infer_media_type(content_type))
    checksum = _normalize_checksum_sha256(body.get("checksumSha256"))
    if not filename:
        raise ValueError("filename is required")
    if media_type not in ("image", "video"):
        raise ValueError("mediaType must be image or video")

    owner_checksum_key = _owner_checksum_key(owner_sub, checksum)
    safe_name = filename.replace("\\", "/").split("/")[-1]

    for _attempt in range(2):
        duplicate = _find_duplicate(owner_sub, checksum)
        if duplicate:
            return _duplicate_upload_response(duplicate)

        media_id = f"media_{uuid.uuid4().hex}"
        object_key = f"uploads/{owner_sub}/{media_id}/{safe_name}"
        created_at = _now()
        item = {
            "mediaId": media_id,
            "ownerSub": owner_sub,
            "originalUrl": None,
            "thumbnailUrl": None,
            "mediaType": media_type,
            "checksumSha256": checksum,
            "tags": [],
            "tagCounts": {},
            "modelVersion": "pending",
            "storageProvider": "s3",
            "storageBucket": MEDIA_BUCKET,
            "storageObject": object_key,
            "thumbnailObject": None,
            "status": "upload_url_issued",
            "createdAt": created_at,
            "updatedAt": created_at,
            "deletedAt": None,
            "checksumVerifiedAt": None,
            "ownerChecksumKey": owner_checksum_key,
        }
        if not _reserve_checksum(owner_checksum_key, media_id, created_at):
            existing_response = _existing_reserved_upload_response(
                owner_sub, owner_checksum_key, checksum, content_type
            )
            if existing_response:
                return existing_response
            continue
        try:
            media_table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(mediaId)",
            )
        except Exception:
            _release_checksum(owner_checksum_key, media_id)
            raise
        return _upload_url_response(item, content_type, checksum)

    raise ValueError("upload for this checksum is already reserved; retry shortly")


def _complete_upload(event: dict[str, Any], media_id: str) -> dict[str, Any]:
    item = _load_owned_media(event, media_id)
    if item.get("status") in ("processing", "processed", "failed", "deleted"):
        _sync_dedup_status_for_media(item, str(item.get("status") or "uploaded"))
        return _response(200, {"media": _json_safe(_with_fresh_media_urls(item))})
    now = _now()
    try:
        media_table.update_item(
            Key={"mediaId": media_id},
            UpdateExpression="SET #s = :status, updatedAt = :updatedAt",
            ConditionExpression="#s = :issued OR #s = :uploaded",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":status": "uploaded",
                ":updatedAt": now,
                ":issued": "upload_url_issued",
                ":uploaded": "uploaded",
            },
        )
        item["status"] = "uploaded"
        item["updatedAt"] = now
        _sync_dedup_status_for_media(item, "uploaded")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        item = _load_owned_media(event, media_id)
        _sync_dedup_status_for_media(item, str(item.get("status") or "uploaded"))
    return _response(200, {"media": _json_safe(_with_fresh_media_urls(item))})


def _list_media(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    params = event.get("queryStringParameters") or {}
    tag = _normalize_tag(params.get("tag")) if params.get("tag") else ""
    min_count = int(params.get("minCount") or "1")
    requested = {tag: min_count} if tag else {}
    items = _query_owned_media(owner_sub, requested)
    return _response(200, {"items": _json_safe(items)})


def _query_media_by_tags(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    requested = _tag_count_query_from_body(_body(event))
    items = _query_owned_media(owner_sub, requested)
    return _response(200, {"query": requested, "items": _json_safe(items)})


def _query_media_by_file(event: dict[str, Any]) -> dict[str, Any]:
    if not INFERENCE_ENDPOINT_URL:
        raise ValueError("inference endpoint is not configured")
    owner_sub = _owner_sub(event)
    body = _body(event)
    image_base64 = str(
        body.get("base64") or body.get("imageBase64") or body.get("image") or ""
    ).strip()
    if not image_base64:
        raise ValueError("base64 image is required")
    image_base64 = _strip_data_url_prefix(image_base64)
    _validate_base64_size(image_base64)
    inference = _post_inference({"base64": image_base64})
    inferred_counts = _counts_from_inference(inference)
    query_counts = {tag: 1 for tag in inferred_counts}
    items = _query_owned_media(owner_sub, query_counts) if query_counts else []
    return _response(
        200,
        {
            "modelVersion": inference.get("model_version"),
            "inferredTagCounts": inferred_counts,
            "query": query_counts,
            "items": _json_safe(items),
        },
    )


def _bulk_update_tags(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    body = _body(event)
    tags = _clean_tags(body.get("tags") or [])
    if not tags:
        raise ValueError("tags must be a non-empty list")
    try:
        operation = int(body.get("operation"))
    except (TypeError, ValueError) as exc:
        raise ValueError("operation must be 1 to add or 0 to remove") from exc
    if operation not in (0, 1):
        raise ValueError("operation must be 1 to add or 0 to remove")

    targets = _target_media_items(owner_sub, body)
    updated: list[dict[str, Any]] = []
    now = _now()
    for item in targets:
        old_tags = {_normalize_tag(tag) for tag in item.get("tags") or []}
        tag_counts = {str(key): int(value) for key, value in (item.get("tagCounts") or {}).items()}
        for tag in tags:
            if operation == 1:
                tag_counts[tag] = max(tag_counts.get(tag, 0), 1)
            else:
                tag_counts.pop(tag, None)
        next_tags = sorted(tag_counts)
        added_tags = sorted(set(next_tags) - old_tags) if operation == 1 else []
        media_table.update_item(
            Key={"mediaId": item["mediaId"]},
            UpdateExpression="SET tags = :tags, tagCounts = :tagCounts, updatedAt = :updatedAt",
            ExpressionAttributeValues={
                ":tags": next_tags,
                ":tagCounts": tag_counts,
                ":updatedAt": now,
            },
        )
        refreshed = dict(item)
        refreshed["tags"] = next_tags
        refreshed["tagCounts"] = tag_counts
        refreshed["updatedAt"] = now
        updated.append(_with_fresh_media_urls(refreshed))
        _notify_tags_added(refreshed, added_tags, tag_counts)
    return _response(200, {"updated": _json_safe(updated)})


def _notify_tags_added(
    media: dict[str, Any], added_tags: list[str], tag_counts: dict[str, int]
) -> None:
    if not NOTIFICATION_TOPIC_ARN or not added_tags:
        return
    media_id = str(media.get("mediaId") or "unknown media")
    owner = str(media.get("ownerSub") or "unknown user")
    for tag in added_tags:
        message = {
            "event": "tag_added",
            "mediaId": media_id,
            "ownerSub": owner,
            "matchedTags": [tag],
            "tagCounts": tag_counts,
        }
        sns.publish(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Subject=f"Aussie EcoLens tag added: {tag}",
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


def _query_original_by_thumbnail(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    body = _body(event)
    thumbnail = str(
        body.get("thumbnailUrl") or body.get("thumbnailObject") or ""
    ).strip()
    if not thumbnail:
        raise ValueError("thumbnailUrl or thumbnailObject is required")
    thumbnail_object = _storage_object_from_url(thumbnail)
    if not thumbnail_object:
        raise ValueError("thumbnail reference is invalid")
    matches = [
        item
        for item in _query_owned_media(owner_sub, {})
        if item.get("mediaType") == "image"
        and item.get("thumbnailObject") == thumbnail_object
    ]
    if not matches:
        raise ValueError("matching image not found")
    item = matches[0]
    return _response(
        200,
        {
            "mediaId": item["mediaId"],
            "thumbnailUrl": item.get("thumbnailUrl"),
            "originalUrl": item.get("originalUrl"),
            "storageObject": item.get("storageObject"),
        },
    )


def _query_owned_media(owner_sub: str, requested: dict[str, int]) -> list[dict[str, Any]]:
    all_items: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        query_kwargs: dict[str, Any] = {
            "IndexName": "ownerSub-createdAt-index",
            "KeyConditionExpression": Key("ownerSub").eq(owner_sub),
        }
        if start_key:
            query_kwargs["ExclusiveStartKey"] = start_key
        result = media_table.query(**query_kwargs)
        all_items.extend(result.get("Items", []))
        start_key = result.get("LastEvaluatedKey")
        if not start_key:
            break
    items = [
        item
        for item in all_items
        if not item.get("deletedAt") and _matches_tag_counts(item, requested)
    ]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return [_with_fresh_media_urls(item) for item in items]


def _get_media(event: dict[str, Any], media_id: str) -> dict[str, Any]:
    item = _load_owned_media(event, media_id)
    return _response(200, {"media": _json_safe(_with_fresh_media_urls(item))})


def _delete_media(event: dict[str, Any], media_id: str) -> dict[str, Any]:
    item = _load_owned_media(event, media_id)
    deleted = _delete_media_item(item)
    return _response(200, {"mediaId": deleted["mediaId"], "deleted": True})


def _bulk_delete_media(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    targets = _target_media_items(owner_sub, _body(event))
    deleted = [_delete_media_item(item) for item in targets]
    return _response(
        200,
        {
            "deleted": _json_safe(deleted),
            "count": len(deleted),
        },
    )


def _delete_media_item(item: dict[str, Any]) -> dict[str, Any]:
    bucket = item.get("storageBucket") or MEDIA_BUCKET
    if item.get("storageObject"):
        s3.delete_object(Bucket=bucket, Key=item["storageObject"])
    if item.get("thumbnailObject") and item.get("thumbnailObject") != item.get("storageObject"):
        s3.delete_object(Bucket=bucket, Key=item["thumbnailObject"])
    media_table.delete_item(
        Key={"mediaId": item["mediaId"]},
        ConditionExpression="ownerSub = :ownerSub",
        ExpressionAttributeValues={":ownerSub": item["ownerSub"]},
    )
    _delete_dedup_for_media(item)
    return {
        "mediaId": item["mediaId"],
        "storageObject": item.get("storageObject"),
        "thumbnailObject": item.get("thumbnailObject"),
    }


def _create_subscription(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    body = _body(event)
    tags = _clean_tags(body.get("tags") or [])
    email = str(body.get("email") or _current_user(event).get("email") or "").strip()
    if not tags:
        raise ValueError("tags must be a non-empty list")
    if not email:
        raise ValueError("email is required")
    sns_status: dict[str, str] = {}
    if NOTIFICATION_TOPIC_ARN:
        route_keys = _active_route_keys_for_email(
            email,
            extra_owner_sub=owner_sub,
            extra_tags=tags,
        )
        sns_status = _subscribe_email_to_topic(email, route_keys)
    now = _now()
    item = {
        "subscriptionId": f"sub_{uuid.uuid4().hex}",
        "ownerSub": owner_sub,
        "email": email,
        "tags": tags,
        "active": True,
        "createdAt": now,
        "updatedAt": now,
        **sns_status,
    }
    subscription_table.put_item(Item=item)
    return _response(200, {"subscription": item})


def _list_subscriptions(event: dict[str, Any]) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    result = subscription_table.query(
        IndexName="ownerSub-createdAt-index",
        KeyConditionExpression=Key("ownerSub").eq(owner_sub),
    )
    return _response(200, {"items": _json_safe(result.get("Items", []))})


def _delete_subscription(event: dict[str, Any], subscription_id: str) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    result = subscription_table.get_item(Key={"subscriptionId": subscription_id})
    item = result.get("Item")
    if not item:
        return _response(404, {"error": "not_found"})
    if item.get("ownerSub") != owner_sub:
        raise PermissionError()
    subscription_table.update_item(
        Key={"subscriptionId": subscription_id},
        UpdateExpression="SET active = :active, updatedAt = :updatedAt",
        ExpressionAttributeValues={":active": False, ":updatedAt": _now()},
    )
    email = str(item.get("email") or "").strip()
    subscription_arn = str(item.get("snsSubscriptionArn") or "")
    if not subscription_arn.startswith("arn:"):
        subscription_arn = _subscription_arn_for_email(email)
    if subscription_arn.startswith("arn:"):
        remaining_route_keys = _active_route_keys_for_email(
            email,
            exclude_subscription_id=subscription_id,
        )
        if remaining_route_keys:
            _set_subscription_filter_policy(subscription_arn, remaining_route_keys)
        else:
            sns.unsubscribe(SubscriptionArn=subscription_arn)
    return _response(200, {"subscriptionId": subscription_id, "deleted": True})


def _subscribe_email_to_topic(email: str, route_keys: list[str]) -> dict[str, str]:
    filter_policy = _filter_policy_json(route_keys)
    arn = _subscription_arn_for_email(email)
    if arn.startswith("arn:"):
        _set_subscription_filter_policy(arn, route_keys)
        return {
            "snsSubscriptionArn": arn,
            "snsStatus": "subscribed",
            "snsFilterPolicy": filter_policy,
        }
    try:
        response = sns.subscribe(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Protocol="email",
            Endpoint=email,
            Attributes={"FilterPolicy": filter_policy},
            ReturnSubscriptionArn=True,
        )
    except ClientError as exc:
        if _is_existing_subscription_attribute_error(exc):
            arn = _subscription_arn_for_email(email)
            if arn.startswith("arn:"):
                _set_subscription_filter_policy(arn, route_keys)
                return {
                    "snsSubscriptionArn": arn,
                    "snsStatus": "subscribed",
                    "snsFilterPolicy": filter_policy,
                }
        raise
    arn = str(response.get("SubscriptionArn") or "")
    if arn.startswith("arn:"):
        _set_subscription_filter_policy(arn, route_keys)
    status = "pending_confirmation" if arn == "pending confirmation" else "subscribed"
    return {
        "snsSubscriptionArn": arn,
        "snsStatus": status,
        "snsFilterPolicy": filter_policy,
    }


def _is_existing_subscription_attribute_error(exc: ClientError) -> bool:
    error = exc.response.get("Error", {})
    message = str(error.get("Message") or "")
    return (
        error.get("Code") in {"InvalidParameter", "InvalidParameterException"}
        and "Subscription already exists with different attributes" in message
    )


def _set_subscription_filter_policy(subscription_arn: str, route_keys: list[str]) -> None:
    filter_policy = _filter_policy_json(route_keys)
    sns.set_subscription_attributes(
        SubscriptionArn=subscription_arn,
        AttributeName="FilterPolicy",
        AttributeValue=filter_policy,
    )
    sns.set_subscription_attributes(
        SubscriptionArn=subscription_arn,
        AttributeName="FilterPolicyScope",
        AttributeValue="MessageAttributes",
    )


def _notification_route_key(owner_sub: str, tag: str) -> str:
    clean_owner = str(owner_sub or "").strip()
    clean_tag = _normalize_tag(tag)
    if not clean_owner or not clean_tag:
        return ""
    return f"{clean_owner}#{clean_tag}"


def _notification_filter_policy(route_keys: list[str]) -> dict[str, list[str]]:
    return {"routeKey": sorted({key for key in route_keys if key})}


def _filter_policy_json(route_keys: list[str]) -> str:
    return json.dumps(
        _notification_filter_policy(route_keys),
        sort_keys=True,
        separators=(",", ":"),
    )


def _active_route_keys_for_email(
    email: str,
    *,
    extra_owner_sub: str | None = None,
    extra_tags: list[str] | None = None,
    exclude_subscription_id: str | None = None,
) -> list[str]:
    route_keys = set()
    if extra_owner_sub and extra_tags:
        route_keys.update(
            key
            for tag in extra_tags
            if (key := _notification_route_key(extra_owner_sub, tag))
        )
    start_key: dict[str, Any] | None = None
    while True:
        query_kwargs: dict[str, Any] = {
            "IndexName": "email-index",
            "KeyConditionExpression": Key("email").eq(email),
        }
        if start_key:
            query_kwargs["ExclusiveStartKey"] = start_key
        result = subscription_table.query(**query_kwargs)
        for item in result.get("Items", []):
            if item.get("subscriptionId") == exclude_subscription_id:
                continue
            if not item.get("active", True):
                continue
            owner_sub = str(item.get("ownerSub") or "").strip()
            route_keys.update(
                key
                for tag in _clean_tags(item.get("tags") or [])
                if (key := _notification_route_key(owner_sub, tag))
            )
        start_key = result.get("LastEvaluatedKey")
        if not start_key:
            break
    return sorted(route_keys)


def _subscription_arn_for_email(email: str) -> str:
    if not NOTIFICATION_TOPIC_ARN or not email:
        return ""
    next_token = ""
    while True:
        kwargs: dict[str, Any] = {"TopicArn": NOTIFICATION_TOPIC_ARN}
        if next_token:
            kwargs["NextToken"] = next_token
        result = sns.list_subscriptions_by_topic(**kwargs)
        for subscription in result.get("Subscriptions", []):
            if subscription.get("Protocol") != "email":
                continue
            if str(subscription.get("Endpoint") or "").strip() != email:
                continue
            arn = str(subscription.get("SubscriptionArn") or "")
            return arn if arn.startswith("arn:") else ""
        next_token = str(result.get("NextToken") or "")
        if not next_token:
            return ""


def _load_owned_media(event: dict[str, Any], media_id: str) -> dict[str, Any]:
    owner_sub = _owner_sub(event)
    result = media_table.get_item(Key={"mediaId": media_id})
    item = result.get("Item")
    if not item:
        raise ValueError("media item not found")
    if item.get("ownerSub") != owner_sub:
        raise PermissionError()
    if item.get("deletedAt") or item.get("status") == "deleted":
        raise ValueError("media item not found")
    return item


def _infer_media_type(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


def _with_fresh_media_urls(item: dict[str, Any]) -> dict[str, Any]:
    hydrated = dict(item)
    bucket = hydrated.get("storageBucket") or MEDIA_BUCKET
    storage_object = hydrated.get("storageObject")
    thumbnail_object = hydrated.get("thumbnailObject")
    if storage_object:
        hydrated["originalUrl"] = _presigned_get_url(bucket, storage_object)
    if thumbnail_object:
        hydrated["thumbnailUrl"] = _presigned_get_url(bucket, thumbnail_object)
    return hydrated


def _presigned_get_url(bucket: str, key: str, expires: int = 3600) -> str:
    return s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def _owner_checksum_key(owner_sub: str, checksum: str) -> str:
    return f"{owner_sub}#{checksum}"


def _upload_headers(content_type: str, checksum: str) -> dict[str, str]:
    return {
        "Content-Type": content_type,
        "x-amz-meta-checksum-sha256": checksum,
    }


def _presigned_put_url(item: dict[str, Any], content_type: str, checksum: str) -> str:
    return s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": item.get("storageBucket") or MEDIA_BUCKET,
            "Key": item["storageObject"],
            "ContentType": content_type,
            "Metadata": {"checksum-sha256": checksum},
        },
        ExpiresIn=PRESIGNED_URL_TTL_SECONDS,
    )


def _upload_url_response(
    item: dict[str, Any], content_type: str, checksum: str, *, reserved: bool = False
) -> dict[str, Any]:
    return _response(
        200,
        {
            "duplicate": False,
            "reserved": reserved,
            "mediaId": item["mediaId"],
            "uploadUrl": _presigned_put_url(item, content_type, checksum),
            "uploadHeaders": _upload_headers(content_type, checksum),
            "bucket": item.get("storageBucket") or MEDIA_BUCKET,
            "objectKey": item["storageObject"],
            "expiresIn": PRESIGNED_URL_TTL_SECONDS,
        },
    )


def _duplicate_upload_response(item: dict[str, Any]) -> dict[str, Any]:
    return _response(
        200,
        {
            "duplicate": True,
            "mediaId": item["mediaId"],
            "uploadUrl": None,
            "bucket": item.get("storageBucket"),
            "objectKey": item.get("storageObject"),
            "uploadHeaders": {},
            "expiresIn": 0,
            "media": _json_safe(_with_fresh_media_urls(item)),
        },
    )


def _reserve_checksum(owner_checksum_key: str, media_id: str, created_at: str) -> bool:
    if dedup_table is None:
        return True
    now_epoch = _epoch_now()
    try:
        dedup_table.put_item(
            Item={
                "ownerChecksumKey": owner_checksum_key,
                "mediaId": media_id,
                "status": "reserved",
                "createdAt": created_at,
                "updatedAt": created_at,
                "expiresAt": now_epoch + DEDUP_RESERVATION_TTL_SECONDS,
            },
            ConditionExpression=(
                "attribute_not_exists(ownerChecksumKey) "
                "OR expiresAt < :now "
                "OR #s IN (:failed, :deleted)"
            ),
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":now": now_epoch,
                ":failed": "failed",
                ":deleted": "deleted",
            },
        )
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def _existing_reserved_upload_response(
    owner_sub: str, owner_checksum_key: str, checksum: str, content_type: str
) -> dict[str, Any] | None:
    if dedup_table is None:
        return None
    reservation = dedup_table.get_item(
        Key={"ownerChecksumKey": owner_checksum_key}
    ).get("Item")
    media_id = str((reservation or {}).get("mediaId") or "")
    if not media_id:
        return None
    result = media_table.get_item(Key={"mediaId": media_id})
    item = result.get("Item")
    if not item:
        if int((reservation or {}).get("expiresAt") or 0) < _epoch_now():
            _mark_dedup_status(
                owner_checksum_key, media_id, "failed", expires_at=_epoch_now()
            )
        return None
    if item.get("ownerSub") != owner_sub:
        _mark_dedup_status(owner_checksum_key, media_id, "failed", expires_at=_epoch_now())
        return None
    if item.get("deletedAt") or item.get("status") in ("failed", "deleted"):
        _mark_dedup_status(owner_checksum_key, media_id, "failed", expires_at=_epoch_now())
        return None

    object_exists = _media_object_exists(item)
    if item.get("status") == "upload_url_issued" and not object_exists:
        return _upload_url_response(item, content_type, checksum, reserved=True)
    if not object_exists:
        _mark_dedup_status(owner_checksum_key, media_id, "failed", expires_at=_epoch_now())
        return None
    if _is_duplicate_candidate(item):
        return _duplicate_upload_response(item)
    return None


def _release_checksum(owner_checksum_key: str, media_id: str) -> None:
    if dedup_table is None:
        return
    try:
        dedup_table.delete_item(
            Key={"ownerChecksumKey": owner_checksum_key},
            ConditionExpression="mediaId = :mediaId",
            ExpressionAttributeValues={":mediaId": media_id},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _sync_dedup_status_for_media(item: dict[str, Any], status: str) -> None:
    owner_checksum_key = str(item.get("ownerChecksumKey") or "")
    media_id = str(item.get("mediaId") or "")
    if not owner_checksum_key or not media_id:
        return
    if status in ("failed", "deleted"):
        _mark_dedup_status(owner_checksum_key, media_id, status, expires_at=_epoch_now())
    else:
        _mark_dedup_status(owner_checksum_key, media_id, status)


def _mark_dedup_status(
    owner_checksum_key: str,
    media_id: str,
    status: str,
    *,
    expires_at: int | None = None,
) -> None:
    if dedup_table is None or not owner_checksum_key or not media_id:
        return
    now = _now()
    update_expression = "SET mediaId = :mediaId, #s = :status, updatedAt = :updatedAt"
    values: dict[str, Any] = {
        ":mediaId": media_id,
        ":status": status,
        ":updatedAt": now,
    }
    if expires_at is None:
        update_expression += " REMOVE expiresAt"
    else:
        update_expression += ", expiresAt = :expiresAt"
        values[":expiresAt"] = expires_at
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


def _delete_dedup_for_media(item: dict[str, Any]) -> None:
    owner_checksum_key = str(item.get("ownerChecksumKey") or "")
    media_id = str(item.get("mediaId") or "")
    if dedup_table is None or not owner_checksum_key or not media_id:
        return
    try:
        dedup_table.delete_item(
            Key={"ownerChecksumKey": owner_checksum_key},
            ConditionExpression="mediaId = :mediaId",
            ExpressionAttributeValues={":mediaId": media_id},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _normalize_checksum_sha256(value: Any) -> str:
    checksum = str(value or "").strip().lower()
    if len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
        raise ValueError("checksumSha256 must be a 64-character hex SHA-256 digest")
    return checksum


def _find_duplicate(owner_sub: str, checksum: str) -> dict[str, Any] | None:
    result = media_table.query(
        IndexName="ownerChecksumKey-index",
        KeyConditionExpression=Key("ownerChecksumKey").eq(
            _owner_checksum_key(owner_sub, checksum)
        ),
    )
    candidates = [
        item
        for item in result.get("Items", [])
        if item.get("ownerSub") == owner_sub and _is_duplicate_candidate(item)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return candidates[0]


def _is_duplicate_candidate(item: dict[str, Any]) -> bool:
    if item.get("deletedAt"):
        return False
    if item.get("status") in ("failed", "deleted"):
        return False
    return _media_object_exists(item)


def _media_object_exists(item: dict[str, Any]) -> bool:
    key = item.get("storageObject")
    if not key:
        return False
    try:
        s3.head_object(Bucket=item.get("storageBucket") or MEDIA_BUCKET, Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code") or "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def _matches_tag_counts(item: dict[str, Any], requested: dict[str, int]) -> bool:
    if not requested:
        return True
    tag_counts = item.get("tagCounts") or {}
    normalized_counts: dict[str, int] = {}
    for key, value in tag_counts.items():
        tag = _normalize_tag(key)
        if tag:
            normalized_counts[tag] = max(normalized_counts.get(tag, 0), int(value))
    return all(
        int(normalized_counts.get(tag, 0)) >= min_count
        for tag, min_count in requested.items()
    )


def _tag_count_query_from_body(body: dict[str, Any]) -> dict[str, int]:
    raw = body.get("tags", body)
    if not isinstance(raw, dict):
        raise ValueError("tags must be an object mapping tag to minimum count")
    out: dict[str, int] = {}
    for key, value in raw.items():
        tag = _normalize_tag(key)
        if not tag:
            continue
        count = int(value)
        if count < 1:
            raise ValueError("minimum counts must be positive")
        out[tag] = count
    if not out:
        raise ValueError("at least one tag is required")
    return out


def _clean_tags(value: list[Any]) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("tags must be a list")
    return sorted({tag for item in value if (tag := _normalize_tag(item))})


def _normalize_tag(raw: Any) -> str:
    tag = re.sub(r"[\s-]+", "_", str(raw or "").strip().lower())
    tag = re.sub(r"_+", "_", tag)
    return tag.strip("_")


def _clean_string_list(value: Any, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list")
    return [str(item).strip() for item in value if str(item).strip()]


def _target_media_items(owner_sub: str, body: dict[str, Any]) -> list[dict[str, Any]]:
    media_ids = set(_clean_string_list(body.get("mediaIds", []), "mediaIds"))
    urls = set(_clean_string_list(body.get("urls", []), "urls"))
    storage_objects = {_storage_object_from_url(url) for url in urls}
    storage_objects.discard("")
    if not media_ids and not storage_objects:
        raise ValueError("mediaIds or urls must be provided")
    all_items = _query_owned_media(owner_sub, {})
    targets = [
        item
        for item in all_items
        if item.get("mediaId") in media_ids
        or item.get("storageObject") in storage_objects
        or item.get("thumbnailObject") in storage_objects
    ]
    if not targets:
        raise ValueError("no matching owned media found")
    return targets


def _storage_object_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme and parsed.netloc:
        path = urllib.parse.unquote(parsed.path.lstrip("/"))
        bucket_prefix = f"{MEDIA_BUCKET}/"
        if path.startswith(bucket_prefix):
            return path[len(bucket_prefix) :]
        return path
    return urllib.parse.unquote(url.lstrip("/"))


def _strip_data_url_prefix(image_base64: str) -> str:
    if image_base64.startswith("data:") and "," in image_base64:
        return image_base64.split(",", 1)[1]
    return image_base64


def _validate_base64_size(image_base64: str) -> None:
    try:
        decoded = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64 image") from exc
    if len(decoded) > MAX_QUERY_FILE_BYTES:
        raise ValueError("query file is too large")


def _post_inference(image: dict[str, str]) -> dict[str, Any]:
    payload = json.dumps({"image": image, "top_k": INFERENCE_TOP_K}).encode()
    request = urllib.request.Request(
        f"{INFERENCE_ENDPOINT_URL}/inference",
        data=payload,
        headers=_inference_headers(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=INFERENCE_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except (TimeoutError, socket.timeout) as exc:
        raise ValueError("inference request timed out") from exc


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


def _counts_from_inference(inference: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for detection in inference.get("detections", []):
        predictions = detection.get("predictions") or []
        if not predictions:
            continue
        best = predictions[0]
        for key in ("species", "common_name"):
            tag = best.get(key)
            if tag:
                normalized = _normalize_tag(tag)
                if normalized:
                    counts[normalized] = counts.get(normalized, 0) + 1
    return counts


def _json_safe(value: Any) -> Any:
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    return value


def _response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": CORS_ALLOWED_ORIGIN,
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            "Content-Type": "application/json",
        },
        "body": json.dumps(_json_safe(body)),
    }
