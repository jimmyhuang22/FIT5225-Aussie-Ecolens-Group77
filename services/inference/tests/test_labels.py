"""Unit tests for labels.txt parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from inference.labels import LabelEntry, LabelParseError, parse_labels

REPO_ROOT = Path(__file__).resolve().parents[3]
LABELS_PATH = REPO_ROOT / "AussieEcoLense" / "labels.txt"


@pytest.mark.skipif(
    not LABELS_PATH.exists(),
    reason="AussieEcoLense/labels.txt is not present in this checkout",
)
def test_parse_labels_returns_46_entries() -> None:
    entries = parse_labels(LABELS_PATH)
    assert len(entries) == 46


@pytest.mark.skipif(
    not LABELS_PATH.exists(),
    reason="AussieEcoLense/labels.txt is not present in this checkout",
)
def test_known_rows() -> None:
    entries = parse_labels(LABELS_PATH)
    # Row 0 — first line in labels.txt.
    assert entries[0].species_key == "Alectura_lathami"
    assert entries[0].common_name == "australian brushturkey"
    # Row 2 — Bos taurus / cattle.
    assert entries[2].species_key == "Bos_taurus"
    assert entries[2].common_name == "cattle"


def test_species_key_allows_genus_only_rows() -> None:
    entry = LabelEntry(
        taxon_id="",
        class_="mammalia",
        order="rodentia",
        family="muridae",
        genus="rattus",
        species="",
        common_name="rat",
    )
    assert entry.species_key == "Rattus"


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(LabelParseError):
        parse_labels(tmp_path / "does-not-exist.txt")


def test_malformed_row_raises(tmp_path: Path) -> None:
    bad = tmp_path / "labels.txt"
    bad.write_text("only;three;fields\n", encoding="utf-8")
    with pytest.raises(LabelParseError):
        parse_labels(bad)
