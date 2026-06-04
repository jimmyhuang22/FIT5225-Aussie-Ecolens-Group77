from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from typing import Any


class FakeClientError(Exception):
    def __init__(self, error_response: dict[str, Any], operation_name: str) -> None:
        code = error_response.get("Error", {}).get("Code", "ClientError")
        super().__init__(f"An error occurred ({code}) when calling {operation_name}")
        self.response = error_response
        self.operation_name = operation_name


class FakeKey:
    def __init__(self, name: str) -> None:
        self.name = name

    def eq(self, value: str) -> tuple[str, str, str]:
        return ("eq", self.name, value)


class FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeDynamoDb:
    def Table(self, name: str) -> FakeTable:
        return FakeTable(name)


class FakeAwsClient:
    pass


def _install_aws_stubs() -> dict[str, types.ModuleType | None]:
    previous = {
        name: sys.modules.get(name)
        for name in (
            "boto3",
            "boto3.dynamodb",
            "boto3.dynamodb.conditions",
            "botocore",
            "botocore.exceptions",
        )
    }

    boto3_module = types.ModuleType("boto3")
    boto3_module.resource = lambda _service: FakeDynamoDb()
    boto3_module.client = lambda _service: FakeAwsClient()

    boto3_dynamodb_module = types.ModuleType("boto3.dynamodb")
    conditions_module = types.ModuleType("boto3.dynamodb.conditions")
    conditions_module.Key = FakeKey

    botocore_module = types.ModuleType("botocore")
    exceptions_module = types.ModuleType("botocore.exceptions")
    exceptions_module.ClientError = FakeClientError

    sys.modules["boto3"] = boto3_module
    sys.modules["boto3.dynamodb"] = boto3_dynamodb_module
    sys.modules["boto3.dynamodb.conditions"] = conditions_module
    sys.modules["botocore"] = botocore_module
    sys.modules["botocore.exceptions"] = exceptions_module
    return previous


def _restore_modules(previous: dict[str, types.ModuleType | None]) -> None:
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


def _load_app_module():
    env = {
        "MEDIA_BUCKET": "unit-test-bucket",
        "MEDIA_TABLE": "media",
        "SUBSCRIPTION_TABLE": "subscriptions",
        "DEDUP_TABLE": "dedup",
    }
    previous_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    previous_modules = _install_aws_stubs()
    module_name = "aws_api_app_under_test"
    sys.modules.pop(module_name, None)
    try:
        app_path = Path(__file__).resolve().parents[1] / "src" / "app.py"
        spec = importlib.util.spec_from_file_location(module_name, app_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("could not load aws-api app module")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        _restore_modules(previous_modules)
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _event(method: str, path: str, body: str | None = None) -> dict[str, Any]:
    return {
        "httpMethod": method,
        "path": path,
        "body": body,
        "requestContext": {
            "authorizer": {
                "claims": {
                    "sub": "user-1",
                    "cognito:username": "unit-test",
                    "email": "unit@example.com",
                }
            }
        },
    }


class HandlerErrorHandlingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = _load_app_module()
        cls.app.LOG.disabled = True

    def test_malformed_json_returns_400_without_parser_detail(self) -> None:
        response = self.app.handler(_event("POST", "/media/query/tags", "{"), None)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertEqual(body["error"], "bad_request")
        self.assertEqual(body["message"], "invalid JSON body")

    def test_client_error_returns_sanitized_500(self) -> None:
        original = self.app._list_media

        def raise_client_error(_event: dict[str, Any]) -> None:
            raise self.app.ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "secret details"}},
                "Query",
            )

        self.app._list_media = raise_client_error
        try:
            response = self.app.handler(_event("GET", "/media"), None)
        finally:
            self.app._list_media = original

        self.assertEqual(response["statusCode"], 500)
        self.assertEqual(json.loads(response["body"]), {"error": "aws_error"})
        self.assertNotIn("secret details", response["body"])

    def test_unexpected_error_returns_sanitized_500(self) -> None:
        original = self.app._list_media
        self.app._list_media = lambda _event: (_ for _ in ()).throw(
            RuntimeError("private detail")
        )
        try:
            response = self.app.handler(_event("GET", "/media"), None)
        finally:
            self.app._list_media = original

        self.assertEqual(response["statusCode"], 500)
        self.assertEqual(json.loads(response["body"]), {"error": "internal_error"})
        self.assertNotIn("private detail", response["body"])

    def test_existing_confirmed_sns_email_updates_filter_without_resubscribe(self) -> None:
        class ExistingSubscriptionSns:
            def __init__(self) -> None:
                self.attributes: list[dict[str, str]] = []

            def list_subscriptions_by_topic(self, **_kwargs: str) -> dict[str, Any]:
                return {
                    "Subscriptions": [
                        {
                            "Protocol": "email",
                            "Endpoint": "unit@example.com",
                            "SubscriptionArn": "arn:aws:sns:ap-southeast-2:123:topic:sub",
                        }
                    ]
                }

            def subscribe(self, **_kwargs: str) -> dict[str, str]:
                raise AssertionError("existing confirmed email should not be resubscribed")

            def set_subscription_attributes(self, **kwargs: str) -> None:
                self.attributes.append(kwargs)

        original_sns = self.app.sns
        original_topic_arn = self.app.NOTIFICATION_TOPIC_ARN
        fake_sns = ExistingSubscriptionSns()
        self.app.sns = fake_sns
        self.app.NOTIFICATION_TOPIC_ARN = "arn:aws:sns:ap-southeast-2:123:topic"
        try:
            result = self.app._subscribe_email_to_topic(
                "unit@example.com",
                ["user-1#manual_test", "user-1#felis_catus"],
            )
        finally:
            self.app.sns = original_sns
            self.app.NOTIFICATION_TOPIC_ARN = original_topic_arn

        self.assertEqual(result["snsStatus"], "subscribed")
        self.assertEqual(
            result["snsSubscriptionArn"],
            "arn:aws:sns:ap-southeast-2:123:topic:sub",
        )
        self.assertEqual(
            json.loads(result["snsFilterPolicy"]),
            {"routeKey": ["user-1#felis_catus", "user-1#manual_test"]},
        )
        self.assertEqual(len(fake_sns.attributes), 2)
        self.assertEqual(fake_sns.attributes[0]["AttributeName"], "FilterPolicy")
        self.assertEqual(fake_sns.attributes[1]["AttributeName"], "FilterPolicyScope")

    def test_notification_filter_policy_uses_owner_tag_route_keys(self) -> None:
        route_key = self.app._notification_route_key("user-1", " Felis Catus ")
        policy = self.app._notification_filter_policy(
            [route_key, "user-2#felis_catus", route_key]
        )

        self.assertEqual(route_key, "user-1#felis_catus")
        self.assertEqual(
            policy,
            {"routeKey": ["user-1#felis_catus", "user-2#felis_catus"]},
        )

    def test_delete_media_item_hard_deletes_media_record(self) -> None:
        class RecordingS3:
            def __init__(self) -> None:
                self.deleted: list[dict[str, str]] = []

            def delete_object(self, **kwargs: str) -> None:
                self.deleted.append(kwargs)

        class HardDeleteMediaTable:
            def __init__(self) -> None:
                self.deleted: list[dict[str, Any]] = []

            def delete_item(self, **kwargs: Any) -> None:
                self.deleted.append(kwargs)

            def update_item(self, **_kwargs: Any) -> None:
                raise AssertionError("media delete must remove the DynamoDB item")

        class RecordingDedupTable:
            def __init__(self) -> None:
                self.deleted: list[dict[str, Any]] = []

            def delete_item(self, **kwargs: Any) -> None:
                self.deleted.append(kwargs)

        original_s3 = self.app.s3
        original_media_table = self.app.media_table
        original_dedup_table = self.app.dedup_table
        fake_s3 = RecordingS3()
        fake_media_table = HardDeleteMediaTable()
        fake_dedup_table = RecordingDedupTable()
        self.app.s3 = fake_s3
        self.app.media_table = fake_media_table
        self.app.dedup_table = fake_dedup_table
        item = {
            "mediaId": "media-1",
            "ownerSub": "user-1",
            "storageBucket": "media-bucket",
            "storageObject": "uploads/user-1/media-1/original.jpg",
            "thumbnailObject": "thumbnails/user-1/media-1.jpg",
            "ownerChecksumKey": "user-1#abc123",
        }
        try:
            result = self.app._delete_media_item(item)
        finally:
            self.app.s3 = original_s3
            self.app.media_table = original_media_table
            self.app.dedup_table = original_dedup_table

        self.assertEqual(
            fake_s3.deleted,
            [
                {
                    "Bucket": "media-bucket",
                    "Key": "uploads/user-1/media-1/original.jpg",
                },
                {"Bucket": "media-bucket", "Key": "thumbnails/user-1/media-1.jpg"},
            ],
        )
        self.assertEqual(
            fake_media_table.deleted,
            [
                {
                    "Key": {"mediaId": "media-1"},
                    "ConditionExpression": "ownerSub = :ownerSub",
                    "ExpressionAttributeValues": {":ownerSub": "user-1"},
                }
            ],
        )
        self.assertEqual(
            fake_dedup_table.deleted,
            [
                {
                    "Key": {"ownerChecksumKey": "user-1#abc123"},
                    "ConditionExpression": "mediaId = :mediaId",
                    "ExpressionAttributeValues": {":mediaId": "media-1"},
                }
            ],
        )
        self.assertEqual(
            result,
            {
                "mediaId": "media-1",
                "storageObject": "uploads/user-1/media-1/original.jpg",
                "thumbnailObject": "thumbnails/user-1/media-1.jpg",
            },
        )

    def test_load_owned_media_hides_legacy_soft_deleted_records(self) -> None:
        class LegacySoftDeletedMediaTable:
            def get_item(self, **_kwargs: Any) -> dict[str, Any]:
                return {
                    "Item": {
                        "mediaId": "media-1",
                        "ownerSub": "user-1",
                        "status": "deleted",
                        "deletedAt": "2026-06-04T00:00:00Z",
                    }
                }

        original_media_table = self.app.media_table
        self.app.media_table = LegacySoftDeletedMediaTable()
        try:
            with self.assertRaisesRegex(ValueError, "media item not found"):
                self.app._load_owned_media(_event("GET", "/media/media-1"), "media-1")
        finally:
            self.app.media_table = original_media_table


if __name__ == "__main__":
    unittest.main()
