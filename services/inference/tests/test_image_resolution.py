"""Tests for inference image source hardening."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from inference.main import (
    ResolvedImage,
    _cleanup_resolved_image,
    _host_allowed,
    _validate_image_url_allowed,
)


def test_default_url_allowlist_accepts_s3_hosts() -> None:
    assert _host_allowed("s3.amazonaws.com")
    assert _host_allowed("aussie-ecolens.s3.amazonaws.com")
    assert _host_allowed("aussie-ecolens.s3.ap-southeast-2.amazonaws.com")


def test_default_url_allowlist_rejects_non_s3_hosts() -> None:
    try:
        _validate_image_url_allowed("https://example.com/sample.jpg")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "image_url_host_not_allowed"
    else:
        raise AssertionError("non-S3 URL should be rejected")


def test_url_allowlist_rejects_non_https_s3_urls() -> None:
    try:
        _validate_image_url_allowed("http://aussie-ecolens.s3.amazonaws.com/sample.jpg")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "image_url_not_allowed"
    else:
        raise AssertionError("non-HTTPS URL should be rejected")


def test_cleanup_resolved_image_deletes_temp_file(tmp_path: Path) -> None:
    image = tmp_path / "aux-test.img"
    image.write_bytes(b"image")
    _cleanup_resolved_image(ResolvedImage(str(image), cleanup_required=True))
    assert not image.exists()


def test_cleanup_resolved_image_keeps_non_temp_file(tmp_path: Path) -> None:
    image = tmp_path / "cached.img"
    image.write_bytes(b"image")
    _cleanup_resolved_image(ResolvedImage(str(image), cleanup_required=False))
    assert image.exists()
