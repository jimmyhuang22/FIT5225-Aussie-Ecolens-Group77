from __future__ import annotations

import importlib.util
import io
import os
import sys
import types
import unittest
import urllib.error
from pathlib import Path
from typing import Any


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
        for name in ("boto3", "botocore", "botocore.exceptions")
    }

    boto3_module = types.ModuleType("boto3")
    boto3_module.resource = lambda _service: FakeDynamoDb()
    boto3_module.client = lambda _service: FakeAwsClient()

    botocore_module = types.ModuleType("botocore")
    exceptions_module = types.ModuleType("botocore.exceptions")
    exceptions_module.ClientError = Exception

    sys.modules["boto3"] = boto3_module
    sys.modules["botocore"] = botocore_module
    sys.modules["botocore.exceptions"] = exceptions_module
    return previous


def _restore_modules(previous: dict[str, types.ModuleType | None]) -> None:
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


def _load_handler_module() -> Any:
    env = {
        "MEDIA_BUCKET": "unit-test-bucket",
        "MEDIA_TABLE": "media",
        "DEDUP_TABLE": "dedup",
        "NOTIFICATION_TOPIC_ARN": "arn:aws:sns:ap-southeast-2:123:topic",
        "INFERENCE_ENDPOINT_URL": "https://inference.example",
    }
    previous_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    previous_modules = _install_aws_stubs()
    module_name = "aws_processor_handler_under_test"
    sys.modules.pop(module_name, None)
    try:
        handler_path = Path(__file__).resolve().parents[1] / "src" / "handler.py"
        spec = importlib.util.spec_from_file_location(module_name, handler_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("could not load aws-processor handler module")
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


class ProcessorHandlerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.handler = _load_handler_module()
        cls.handler.LOG.disabled = True

    def test_post_inference_reports_http_error_body(self) -> None:
        original_urlopen = self.handler.urllib.request.urlopen

        def raise_http_error(*_args: Any, **_kwargs: Any) -> None:
            raise urllib.error.HTTPError(
                url="https://inference.example/inference",
                code=503,
                msg="Service Unavailable",
                hdrs={},
                fp=io.BytesIO(b'{"error":"models_not_loaded"}'),
            )

        self.handler.urllib.request.urlopen = raise_http_error
        try:
            with self.assertRaisesRegex(
                RuntimeError,
                r'inference service returned 503: \{"error":"models_not_loaded"\}',
            ):
                self.handler._post_inference({"url": "https://signed.example/image.jpg"})
        finally:
            self.handler.urllib.request.urlopen = original_urlopen

    def test_counts_from_inference_normalizes_species_and_common_names(self) -> None:
        inference = {
            "detections": [
                {
                    "predictions": [
                        {"species": "Macropus giganteus", "common_name": "Eastern Grey"}
                    ]
                },
                {
                    "predictions": [
                        {"species": "Macropus giganteus", "common_name": "Eastern-Grey"}
                    ]
                },
                {"predictions": []},
            ]
        }

        self.assertEqual(
            self.handler._counts_from_inference(inference),
            {"macropus_giganteus": 2, "eastern_grey": 2},
        )

    def test_notification_publish_failure_is_best_effort(self) -> None:
        class FailingSns:
            def __init__(self) -> None:
                self.published: list[dict[str, Any]] = []

            def publish(self, **kwargs: Any) -> None:
                self.published.append(kwargs)
                raise RuntimeError("sns offline")

        original_sns = self.handler.sns
        fake_sns = FailingSns()
        self.handler.sns = fake_sns
        try:
            self.handler._notify_matching_subscriptions(
                {"mediaId": "media-1", "ownerSub": "user-1"},
                ["dingo"],
                {"dingo": 1},
            )
        finally:
            self.handler.sns = original_sns

        self.assertEqual(len(fake_sns.published), 1)
        published = fake_sns.published[0]
        self.assertEqual(
            published["Subject"],
            "Aussie EcoLens matched your tag: dingo",
        )
        self.assertFalse(published["Message"].lstrip().startswith("{"))
        self.assertIn("Matched tag: dingo", published["Message"])
        self.assertIn("Media ID: media-1", published["Message"])
        self.assertIn("- dingo x1", published["Message"])
        self.assertNotIn('"ownerSub"', published["Message"])
        self.assertEqual(
            published["MessageAttributes"]["routeKey"]["StringValue"],
            "user-1#dingo",
        )

    def test_video_thumbnail_falls_back_to_first_frame(self) -> None:
        class ThumbnailS3:
            def __init__(self) -> None:
                self.uploaded: list[dict[str, Any]] = []

            def download_file(self, _bucket: str, _key: str, filename: str) -> None:
                Path(filename).write_bytes(b"video")

            def upload_file(
                self, filename: str, bucket: str, key: str, ExtraArgs: dict[str, str]
            ) -> None:
                self.uploaded.append(
                    {
                        "filename_exists": Path(filename).exists(),
                        "bucket": bucket,
                        "key": key,
                        "ExtraArgs": ExtraArgs,
                    }
                )

            def generate_presigned_url(self, **_kwargs: Any) -> str:
                return "https://signed.example/thumbnail.jpg"

        calls: list[str] = []
        original_s3 = self.handler.s3
        original_ffmpeg = self.handler._ffmpeg_executable
        original_run = self.handler.subprocess.run
        fake_s3 = ThumbnailS3()

        def fake_run(command: list[str], **_kwargs: Any) -> None:
            seek_time = command[command.index("-ss") + 1]
            calls.append(seek_time)
            if seek_time == "00:00:00":
                Path(command[-1]).write_bytes(b"thumbnail")

        self.handler.s3 = fake_s3
        self.handler._ffmpeg_executable = lambda: "/usr/bin/ffmpeg"
        self.handler.subprocess.run = fake_run
        try:
            thumbnail_key, thumbnail_url = self.handler._create_video_thumbnail(
                "media-bucket",
                "uploads/user-1/media-1/clip.mp4",
                {
                    "ownerSub": "user-1",
                    "mediaId": "media-1",
                    "mediaType": "video",
                },
            )
        finally:
            self.handler.s3 = original_s3
            self.handler._ffmpeg_executable = original_ffmpeg
            self.handler.subprocess.run = original_run

        self.assertEqual(calls, ["00:00:01", "00:00:00"])
        self.assertEqual(thumbnail_key, "thumbnails/user-1/media-1/thumbnail.jpg")
        self.assertEqual(thumbnail_url, "https://signed.example/thumbnail.jpg")
        self.assertEqual(
            fake_s3.uploaded,
            [
                {
                    "filename_exists": True,
                    "bucket": "media-bucket",
                    "key": "thumbnails/user-1/media-1/thumbnail.jpg",
                    "ExtraArgs": {"ContentType": "image/jpeg"},
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
