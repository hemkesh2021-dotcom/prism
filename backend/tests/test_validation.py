from __future__ import annotations

from prism.parsing import parse_transcript
from prism.schemas import LLMAnalysis
from prism.validation import locate_quote, match_form, utf16_offset, validate_analysis

from .conftest import empty_output


def finding(turn_id, quote, category="identity_dismissal", characteristic="age", **extra):
    item = {
        "turn_id": turn_id,
        "quote": quote,
        "category": category,
        "identity_characteristic": characteristic,
        "explanation": "Worth reviewing in context.",
        "context_note": None,
        "alternative_wording": "My concern with the proposal is [specific technical issue].",
    }
    item.update(extra)
    return item


def run(parsed, **output):
    return validate_analysis(LLMAnalysis.model_validate(empty_output(**output)), parsed)


def notice_codes(notices):
    return {(n.section, n.code): n.count for n in notices}


def test_verified_quote_uses_parsed_speaker(parsed_meeting):
    content, notices = run(parsed_meeting, findings=[finding("T1", "too young to understand this architecture")])
    assert notices == []
    f = content.findings[0]
    assert f.finding_id == "F1"
    assert f.evidence.speaker_label == "Arun" and f.evidence.speaker_id == "S1"
    assert f.evidence.quote == "too young to understand this architecture"


def test_quote_from_another_speakers_turn_is_rejected(parsed_meeting):
    # The words exist, but in Meera's turn (T2), not in the cited turn (T1).
    content, notices = run(parsed_meeting, findings=[finding("T1", "Could you explain which part of my proposal is incorrect?")])
    assert content.findings == []
    assert notice_codes(notices) == {("findings", "wrong_turn"): 1}


def test_nonexistent_and_paraphrased_quotes_are_rejected(parsed_meeting):
    content, notices = run(
        parsed_meeting,
        findings=[
            finding("T1", "you are much too young"),
            finding("T1", "You're too young to understand this architecture."),
        ],
    )
    assert content.findings == []
    assert notice_codes(notices) == {("findings", "quote_not_found"): 2}


def test_unknown_turn_and_empty_quote(parsed_meeting):
    content, notices = run(parsed_meeting, findings=[finding("T99", "too young"), finding("T1", "   "), finding("T1", "...")])
    assert content.findings == []
    assert notice_codes(notices) == {("findings", "unknown_turn"): 1, ("findings", "quote_not_found"): 2}


def test_turn_ids_match_case_insensitively(parsed_meeting):
    content, _ = run(parsed_meeting, findings=[finding("t1", "too young")])
    assert content.findings[0].evidence.turn_id == "T1"


def test_curly_quotes_and_whitespace_equivalence_return_transcript_text():
    parsed = parse_transcript("Meera: I’ve tested it.\nIt “works” under load.")
    content, notices = run(parsed, discussion_points=[{"point": "Testing", "sources": [{"turn_id": "T1", "quote": 'I\'ve tested it. It "works"'}]}])
    assert notices == []
    evidence = content.discussion_points[0].sources[0]
    assert evidence.quote == "I’ve tested it.\nIt “works”"  # the transcript's own characters


def test_match_form_is_length_preserving():
    text = "a’b\u00a0c\n“d”\te"
    assert len(match_form(text)) == len(text)


def test_unicode_highlight_offsets_are_utf16_code_units():
    text = "Ship it 🎉 now — p95 stays under 200 ms 👍 okay"
    parsed = parse_transcript("Lin: " + text)
    content, _ = run(parsed, discussion_points=[{"point": "Latency", "sources": [{"turn_id": "T1", "quote": "p95 stays under 200 ms"}]}])
    hl = content.discussion_points[0].sources[0].highlight
    code_point_start = text.index("p95")
    assert hl.start == code_point_start + 1  # one astral emoji before the quote = one extra UTF-16 unit
    utf16 = text.encode("utf-16-le")
    assert utf16[2 * hl.start : 2 * hl.end].decode("utf-16-le") == "p95 stays under 200 ms"
    assert utf16_offset(text, len(text)) == len(utf16) // 2


def test_repeated_substring_highlights_first_occurrence():
    text = "We should test. Then test again."
    match = locate_quote(text, "test")
    assert match is not None and match.start == text.index("test") and match.occurrences == 2


def test_duplicate_findings_are_merged_but_other_categories_are_kept(parsed_meeting):
    content, notices = run(
        parsed_meeting,
        findings=[
            finding("T1", "too young to understand this architecture"),
            finding("T1", "You are too young"),  # overlaps the first span, same category
            finding("T1", "too young to understand this architecture"),  # identical
            finding("T1", "You are too young", category="personal_attack", characteristic="age"),
        ],
    )
    assert [f.category for f in content.findings] == ["identity_dismissal", "personal_attack"]
    assert notice_codes(notices) == {("findings", "duplicate"): 2}
    assert content.findings[1].identity_characteristic is None  # normalized for personal attacks


def test_owner_and_deadline_must_come_from_the_cited_turns(parsed_meeting):
    sources = [{"turn_id": "T4", "quote": "I'll write the benchmark by next Friday."}]
    content, notices = run(
        parsed_meeting,
        action_items=[
            {"task": "Benchmark", "owner": "meera", "deadline": "Next Friday", "status": "committed", "sources": sources},
            {"task": "Review", "owner": "Ravi", "deadline": "tomorrow", "status": "suggested", "sources": sources},
            # Arun is a participant but neither speaks nor is named in the cited turn.
            {"task": "Pair", "owner": "Arun and Meera", "deadline": None, "status": "suggested", "sources": sources},
        ],
    )
    a1, a2, a3 = content.action_items
    assert (a1.owner, a1.deadline) == ("Meera", "next Friday")  # spelled as in the transcript
    assert (a2.owner, a2.deadline) == (None, None)
    assert a3.owner is None
    assert notice_codes(notices) == {("action_items", "owner_removed"): 2, ("action_items", "deadline_removed"): 1}


def test_owner_and_deadline_use_whole_word_matches():
    parsed = parse_transcript("Priya: Ed, the planning needs a review; you may want Ravi and Ed on it by May 3.")
    sources = [{"turn_id": "T1", "quote": "the planning needs a review"}]
    content, notices = run(
        parsed,
        action_items=[
            {"task": "a", "owner": "Ann", "deadline": "May", "status": "suggested", "sources": sources},  # "Ann" only inside "planning"
            {"task": "b", "owner": "Ravi and Ed", "deadline": "by may 3", "status": "suggested", "sources": sources},
            {"task": "c", "owner": "Priya", "deadline": "Jun", "status": "suggested", "sources": sources},
            {"task": "d", "owner": "Will", "deadline": "may", "status": "suggested", "sources": [{"turn_id": "T1", "quote": "you may want"}]},
        ],
    )
    a, b, c, d = content.action_items
    assert a.owner is None and a.deadline == "May"  # the month in "May 3", not the verb "may"
    assert (b.owner, b.deadline) == ("Ravi and Ed", "by May 3")
    assert (c.owner, c.deadline) == ("Priya", None)  # speaker of the cited turn; "Jun" is not stated
    assert d.owner is None  # no one called Will; single words never match a different case


def test_items_keep_verified_sources_and_drop_when_none_verify(parsed_meeting):
    content, notices = run(
        parsed_meeting,
        decisions=[
            {"decision": "Benchmark first", "status": "agreed", "sources": [
                {"turn_id": "T4", "quote": "Let us benchmark it before deciding."},
                {"turn_id": "T4", "quote": "We all agreed to benchmark"},
            ]},
            {"decision": "Invented", "status": "agreed", "sources": [{"turn_id": "T3", "quote": "we will ship tomorrow"}]},
        ],
    )
    assert [d.text for d in content.decisions] == ["Benchmark first"]
    assert len(content.decisions[0].sources) == 1
    assert notice_codes(notices) == {("decisions", "source_removed"): 1, ("decisions", "no_verified_source"): 1}


def test_suggestions_links_and_general_guidance(parsed_meeting):
    content, notices = run(
        parsed_meeting,
        findings=[finding("T1", "not in the transcript"), finding("T1", "too young")],
        suggestions=[
            {"suggestion": "Name the technical concern.", "basis": "evidence", "finding_index": 1, "sources": []},
            {"suggestion": "Linked to a rejected finding only.", "basis": "evidence", "finding_index": 0, "sources": []},
            {"suggestion": "General tip.", "basis": "general", "finding_index": 1, "sources": [{"turn_id": "T1", "quote": "too young"}]},
        ],
    )
    s1, s2 = content.suggestions
    assert s1.related_finding_id == "F1" and s1.basis == "evidence"
    assert s2.basis == "general" and s2.related_finding_id is None and s2.sources == []
    codes = notice_codes(notices)
    assert codes[("suggestions", "link_removed")] == 1 and codes[("suggestions", "unsupported")] == 1


def test_empty_output_is_valid_and_produces_no_notices(parsed_meeting):
    content, notices = run(parsed_meeting)
    assert content.findings == [] and notices == []
