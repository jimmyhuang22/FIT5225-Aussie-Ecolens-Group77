"""Parse the semicolon-delimited labels.txt into an ordered list of LabelEntry.

File schema (one row per species):
    taxon_id;class;order;family;genus;species_epithet;common_name

The row order MUST match the SpeciesNet model's output class order. The reference
implementation (``AussieEcoLense/batch.py``) hardcodes a Python list of species
keys in the same order. This parser reproduces that order by yielding entries in
file order.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LabelEntry:
    """One species row.

    ``species_key`` is the title-cased ``Genus_species`` form used by
    ``AussieEcoLense/batch.py`` (e.g. ``Bos_taurus``). Genus-only rows such as
    ``rattus;;`` become ``Rattus``. The key is the canonical species identifier
    stored on ``media_items.tags`` per the Phase 1 metadata schema.
    """

    taxon_id: str
    class_: str
    order: str
    family: str
    genus: str
    species: str
    common_name: str

    @property
    def species_key(self) -> str:
        genus = self.genus[:1].upper() + self.genus[1:]
        if not self.species:
            return genus
        return f"{genus}_{self.species}"


class LabelParseError(RuntimeError):
    """Raised when labels.txt has a malformed row."""


def parse_labels(path: str | Path) -> list[LabelEntry]:
    """Read ``path`` and return labels in file order.

    Lines that are blank or start with ``#`` are skipped. Every kept line must
    have exactly seven semicolon-delimited fields.
    """

    src = Path(path)
    if not src.is_file():
        raise LabelParseError(f"Labels file not found: {src}")

    entries: list[LabelEntry] = []
    with src.open("r", encoding="utf-8") as fh:
        for line_number, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            fields = line.split(";")
            if len(fields) != 7:
                raise LabelParseError(
                    f"{src}:{line_number}: expected 7 semicolon-delimited fields, "
                    f"got {len(fields)}: {line!r}"
                )
            taxon_id, class_, order, family, genus, species, common = (
                field.strip() for field in fields
            )
            entries.append(
                LabelEntry(
                    taxon_id=taxon_id,
                    class_=class_,
                    order=order,
                    family=family,
                    genus=genus,
                    species=species,
                    common_name=common,
                )
            )
    if not entries:
        raise LabelParseError(f"{src}: no label rows parsed")
    return entries
