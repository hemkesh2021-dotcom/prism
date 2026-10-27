"""Deterministic word counting and participation statistics.

Word rule (documented in README):

* A word is a run of letters or digits (any script).
* Runs joined by an internal hyphen, apostrophe (' or ’), underscore or period
  stay one word: don't, Arun's, well-known, state-of-the-art, user_id, v2.0, 3.5, e.g.
* A comma between two digits joins them: 1,000 and 1,000.50 are one word each.
* Punctuation, symbols and emoji are not words: "50%" is one word, "—" and "🎉" are zero.

Percentages are computed from full counts and rounded only for display.
"""

from __future__ import annotations

import re
import unicodedata

from .schemas import SpeakerStats, Turn

WORD_PATTERN = re.compile(r"[^\W_]+(?:(?:[-'’_.]|(?<=\d),(?=\d))[^\W_]+)*")


def count_words(text: str) -> int:
    return sum(1 for _ in WORD_PATTERN.finditer(unicodedata.normalize("NFC", text)))


def compute_participation(turns: list[Turn], speaker_order: list[tuple[str, str]]) -> tuple[list[SpeakerStats], int]:
    """Return per-speaker statistics (in first-appearance order) and the total word count.

    `speaker_order` lists (speaker_id, label) pairs in order of first appearance.
    """
    words: dict[str, int] = {sid: 0 for sid, _ in speaker_order}
    turn_counts: dict[str, int] = {sid: 0 for sid, _ in speaker_order}
    for turn in turns:
        words[turn.speaker_id] += turn.word_count
        turn_counts[turn.speaker_id] += 1
    total = sum(words.values())
    stats = [
        SpeakerStats(
            speaker_id=sid,
            label=label,
            order=position,
            words=words[sid],
            turns=turn_counts[sid],
            word_share=(words[sid] / total) if total > 0 else None,
        )
        for position, (sid, label) in enumerate(speaker_order)
    ]
    return stats, total
