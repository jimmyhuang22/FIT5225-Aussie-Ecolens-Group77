"""Helpers for resolving model / image paths that may live on GCS."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

LOG = logging.getLogger(__name__)


def is_gcs_uri(value: str) -> bool:
    return value.startswith("gs://")


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    """Return (bucket, object_key) for a gs://bucket/key URI."""

    if not is_gcs_uri(uri):
        raise ValueError(f"Not a GCS URI: {uri}")
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise ValueError(f"Malformed GCS URI: {uri}")
    return bucket, key


def download_if_gcs(uri_or_path: str, dest_dir: str | Path) -> str:
    """Resolve a local path or download a gs:// URI into ``dest_dir``."""

    if not is_gcs_uri(uri_or_path):
        return uri_or_path

    bucket_name, key = parse_gcs_uri(uri_or_path)
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    local_path = dest / Path(key).name

    from google.cloud import storage  # type: ignore import-untyped

    LOG.info("Downloading %s to %s", uri_or_path, local_path)
    client = storage.Client()
    blob = client.bucket(bucket_name).blob(key)
    blob.download_to_filename(str(local_path))
    LOG.info("Download complete: %s (%d bytes)", local_path, local_path.stat().st_size)
    return str(local_path)
