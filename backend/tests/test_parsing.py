from __future__ import annotations

import pytest

from prism.config import Settings
from prism.errors import PrismError
from prism.parsing import canonicalize, check_transcript_input, is_valid_label, parse_transcript, split_labeled_line


def codes(result, severity=None):
    return [i.code for i in result.issues if severity is None or i.severity == severity]


def test_basic_turns_speakers_and_ids():
    result = parse_transcript("Arun: Hello team.\nMeera: Hi Arun.\nArun: Let's begin.")
    assert result.ok
    assert [t.turn_id for t in result.turns] == ["T1", "T2", "T3"]
    assert [t.speaker_id for t in result.turns] == ["S1", "S2", "S1"]
    assert [s.label for s in result.speakers] == ["Arun", "Meera"]
    assert result.total_turns == 3


def test_split_at_first_separator_and_keep_later_colons():
    result = parse_transcript("Arun: Agenda: item one: the cache.\nMeera: Ratio is 3:1 for reads: writes.")
    assert result.turns[0].speaker_label == "Arun"
    assert result.turns[0].text == "Agenda: item one: the cache."
    assert result.turns[1].text == "Ratio is 3:1 for reads: writes."


def test_continuation_lines_join_previous_turn():
    text = "Farah: First line.\n  Second line continues.\n\nThird after a blank line.\nTomás: Next speaker."
    result = parse_transcript(text)
    assert result.ok
    assert result.total_turns == 2
    assert result.turns[0].text == "First line.\nSecond line continues.\nThird after a blank line."
    assert result.turns[0].line_start == 1 and result.turns[0].line_end == 4
    info = next(i for i in result.issues if i.code == "continuation_lines")
    assert info.severity == "info" and info.lines == [2, 4]


def test_urls_and_times_are_not_speaker_lines():
    text = "Lin: See the doc.\nhttps://example.com/doc\n10:30 works for everyone?\nPriya: Yes."
    result = parse_transcript(text)
    assert [t.speaker_label for t in result.turns] == ["Lin", "Priya"]
    assert result.turns[0].text == "See the doc.\nhttps://example.com/doc\n10:30 works for everyone?"


def test_text_before_first_speaker_is_an_error_but_blank_lines_are_fine():
    bad = parse_transcript("Meeting notes for Monday\nArun: Hello.")
    assert not bad.ok
    assert "text_before_first_speaker" in codes(bad, "error")
    assert bad.issues[0].lines == [1]
    good = parse_transcript("\n\n   \nArun: Hello.")
    assert good.ok and good.total_turns == 1


def test_no_speaker_lines_is_an_error():
    result = parse_transcript("just some text\nwith no labels")
    assert not result.ok
    assert {"text_before_first_speaker", "no_speaker_lines"} <= set(codes(result, "error"))


def test_bom_and_line_endings_are_canonicalized():
    a = parse_transcript("\ufeffArun: Hi.\r\nMeera: Hello.\rArun: Bye.")
    b = parse_transcript("Arun: Hi.\nMeera: Hello.\nArun: Bye.")
    assert a.transcript_hash == b.transcript_hash
    assert [t.text for t in a.turns] == ["Hi.", "Hello.", "Bye."]
    assert canonicalize("\ufeffx\r\ny") == "x\ny"


def test_labels_are_trimmed_but_never_merged():
    result = parse_transcript("  Arun  : One.\narun: Two.\nArun K: Three.")
    assert [s.label for s in result.speakers] == ["Arun", "arun", "Arun K"]
    warning = next(i for i in result.issues if i.code == "similar_speaker_labels")
    assert "“Arun”" in warning.message and "“arun”" in warning.message
    assert result.ok  # warnings never block analysis


def test_missing_space_after_colon_warns_and_continues_turn():
    result = parse_transcript("Arun: First.\nMeera:I think so.")
    assert result.total_turns == 1
    assert "missing_space_after_colon" in codes(result, "warning")


def test_empty_turn_and_heading_like_label_warnings():
    result = parse_transcript("Agenda: Q3 planning\nArun:\nMeera: Hello.")
    assert result.ok
    assert {"empty_turn", "heading_like_label"} <= set(codes(result, "warning"))
    empty = next(t for t in result.turns if t.speaker_label == "Arun")
    assert empty.text == "" and empty.word_count == 0


@pytest.mark.parametrize(
    ("label", "valid"),
    [
        ("Arun", True),
        ("Dr. Priya Raman", True),
        ("Speaker 1 (Host)", True),
        ("Zoë", True),
        ("O’Neil", True),
        ("1st speaker", False),
        ("So the main thing we said", False),  # more than five words
        ("x" * 41, False),
        ("Arun@corp", False),
        ("", False),
    ],
)
def test_label_rules(label, valid):
    assert is_valid_label(label) is valid


def test_split_labeled_line_requires_space_or_end_after_colon():
    assert split_labeled_line("Arun: hi") == ("Arun", "hi")
    assert split_labeled_line("Arun:") == ("Arun", "")
    assert split_labeled_line("Arun:\tTabbed") == ("Arun", "Tabbed")
    assert split_labeled_line("Arun:hi") is None
    assert split_labeled_line(": no label") is None


def test_input_checks():
    settings = Settings(max_transcript_chars=100, max_upload_bytes=1024)
    with pytest.raises(PrismError) as empty:
        check_transcript_input("   \n  ", settings)
    assert empty.value.code == "transcript_empty"

    with pytest.raises(PrismError) as long:
        check_transcript_input("A: " + "x" * 200, settings)
    assert long.value.code == "transcript_too_long" and long.value.status == 413

    with pytest.raises(PrismError) as control:
        check_transcript_input("A: hi\x00there", settings)
    assert control.value.code == "unsupported_encoding"

    with pytest.raises(PrismError) as surrogate:
        check_transcript_input("A: broken \ud800 text", settings)
    assert surrogate.value.code == "unsupported_encoding"

    check_transcript_input("A: fine\tand tabbed", settings)  # no exception


def test_limit_counts_code_points_after_canonicalization():
    settings = Settings(max_transcript_chars=10, max_upload_bytes=1024)
    check_transcript_input(canonicalize("A: 🎉🎉🎉\r\n"), settings)  # 7 code points after CRLF -> LF


def test_replacement_character_warning():
    result = parse_transcript("Arun: caf\ufffd is open.")
    assert "replacement_characters" in codes(result, "warning")


def test_unicode_line_separators_split_lines():
    result = parse_transcript("Arun: hello\u2028Meera: hi\u0085Arun: bye")
    assert [t.speaker_label for t in result.turns] == ["Arun", "Meera", "Arun"]


def test_sentence_like_label_gets_a_warning():
    result = parse_transcript("Arun: The plan is set.\nBottom line: we ship Friday.\nMeera: Great.\nArun: Thanks.")
    warning = next(i for i in result.issues if i.code == "label_looks_like_text")
    assert "Bottom line" in warning.message
    assert not any(i.code == "label_looks_like_text" for i in parse_transcript("Dr. Priya Raman: Hi.").issues)
