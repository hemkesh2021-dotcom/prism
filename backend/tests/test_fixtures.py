from __future__ import annotations

import pytest

from prism.parsing import parse_transcript
from prism.validation import validate_analysis

EXPECTED = {
    # sample_id: (verified findings, notices)
    "neutral-planning": (0, 0),
    "technical-disagreement": (0, 0),
    "age-dismissal": (2, 1),
}


@pytest.mark.parametrize("sample_id", sorted(EXPECTED))
def test_bundled_fixtures_validate(catalog, sample_id):
    text = next(s.transcript for s in catalog.list() if s.sample_id == sample_id)
    _sample, output = catalog.demo_output(sample_id, text)
    content, notices = validate_analysis(output, parse_transcript(text))
    assert (len(content.findings), len(notices)) == EXPECTED[sample_id]
    for item in [*content.discussion_points, *content.decisions, *content.action_items]:
        assert item.sources, "every summary item keeps at least one verified source"


def test_bundled_samples_parse_cleanly(catalog):
    for sample in catalog.list():
        result = parse_transcript(sample.transcript)
        assert result.ok
        assert not [i for i in result.issues if i.severity == "warning"]
