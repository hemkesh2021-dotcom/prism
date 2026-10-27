"""Bundled samples and demo fixtures.

A demo fixture is hand-written model output for one exact bundled sample. It is
bound to that sample by the SHA-256 of the sample's canonical text and is run
through the same schema and evidence validation as live output. Fixtures are
never applied to edited or arbitrary transcripts, and a failed live request is
never answered with demo data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from .errors import PrismError
from .parsing import canonicalize, transcript_hash
from .schemas import LLMAnalysis, SampleInfo


@dataclass(frozen=True)
class Sample:
    sample_id: str
    title: str
    description: str
    transcript: str  # canonical text
    sha256: str
    fixture_path: Path | None


class SampleCatalog:
    def __init__(self, samples: list[Sample]) -> None:
        self._samples = {sample.sample_id: sample for sample in samples}
        self._order = [sample.sample_id for sample in samples]

    @classmethod
    def load(cls, directory: Path) -> SampleCatalog:
        catalog_file = directory / "catalog.json"
        if not catalog_file.exists():
            return cls([])
        entries = json.loads(catalog_file.read_text(encoding="utf-8"))
        samples = []
        for entry in entries["samples"]:
            text = canonicalize((directory / entry["file"]).read_text(encoding="utf-8"))
            fixture = entry.get("fixture")
            samples.append(
                Sample(
                    sample_id=entry["id"],
                    title=entry["title"],
                    description=entry["description"],
                    transcript=text,
                    sha256=transcript_hash(text),
                    fixture_path=(directory / fixture) if fixture else None,
                )
            )
        return cls(samples)

    def list(self) -> list[SampleInfo]:
        return [
            SampleInfo(
                sample_id=sample.sample_id,
                title=sample.title,
                description=sample.description,
                transcript=sample.transcript,
                demo_available=sample.fixture_path is not None and sample.fixture_path.exists(),
            )
            for sample in (self._samples[sid] for sid in self._order)
        ]

    def get(self, sample_id: str) -> Sample | None:
        return self._samples.get(sample_id)

    def demo_output(self, sample_id: str | None, canonical_transcript: str) -> tuple[Sample, LLMAnalysis]:
        sample = self._samples.get(sample_id or "")
        if sample is None:
            raise PrismError(
                "demo_unavailable",
                "Sample demo works only with a bundled sample. Load one with “Load sample”, or use Live analysis.",
                status=409,
            )
        if transcript_hash(canonical_transcript) != sample.sha256:
            raise PrismError(
                "demo_requires_unedited_sample",
                f"Demo results apply only to the unedited “{sample.title}” sample, and this text has changed. "
                "Reload the sample, or use Live analysis for edited text.",
                status=409,
            )
        if sample.fixture_path is None or not sample.fixture_path.exists():
            raise PrismError("demo_unavailable", "This sample has no demo fixture.", status=409)

        payload = json.loads(sample.fixture_path.read_text(encoding="utf-8"))
        if payload.get("sample_sha256") != sample.sha256:
            raise PrismError(
                "demo_fixture_mismatch",
                "The demo fixture no longer matches its bundled sample text (the sample file was edited). "
                "Restore the sample file or update the fixture.",
                status=500,
            )
        try:
            output = LLMAnalysis.model_validate(payload["model_output"])
        except (KeyError, ValidationError):
            raise PrismError(
                "demo_fixture_invalid",
                "The demo fixture does not match the analysis schema.",
                status=500,
            ) from None
        return sample, output
