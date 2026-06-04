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


if __name__ == "__main__":
    unittest.main()
