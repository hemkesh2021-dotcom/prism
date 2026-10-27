from __future__ import annotations

import math

import pytest

from prism.metrics import count_words
from prism.parsing import parse_transcript


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("don't", 1),
        ("Arun's idea", 2),
        ("we’re ready", 2),
        ("well-known state-of-the-art plan", 3),
        ("3.5 or 1,000 or 1,000.50", 5),
        ("v2.0 shipped", 2),
        ("50% of the $20 budget", 5),
        ("user_id and e.g. this", 4),
        ("A/B test", 3),
        ("word—word", 2),
        ("wait -- what", 2),
        ("... !!! — 🎉", 0),
        ("Zoë said héllo", 3),
        ("", 0),
    ],
)
def test_word_rule(text, expected):
    assert count_words(text) == expected


def test_word_share_uses_full_counts_and_sums_to_one():
    result = parse_transcript("A: one two three\nB: one\nC: one two")
    shares = {s.label: s.word_share for s in result.speakers}
    assert result.total_words == 6
    assert shares["A"] == pytest.approx(0.5)
    assert shares["B"] == pytest.approx(1 / 6)  # not rounded in the API
    assert math.isclose(sum(shares.values()), 1.0)
    assert [s.turns for s in result.speakers] == [1, 1, 1]


def test_zero_total_words_has_no_division_error():
    result = parse_transcript("A: ...\nB: 🎉")
    assert result.total_words == 0
    assert all(s.word_share is None for s in result.speakers)
    assert any(i.code == "no_countable_words" for i in result.issues)


def test_speaker_turn_counts_include_empty_turns():
    result = parse_transcript("A: hello\nA:\nB: hi")
    a = next(s for s in result.speakers if s.label == "A")
    assert a.turns == 2 and a.words == 1
