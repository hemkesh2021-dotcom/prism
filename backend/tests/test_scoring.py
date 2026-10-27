"""Tests for evaluation/scoring.py (synthetic inputs; these are not accuracy results)."""

from __future__ import annotations

import json
import sys

from prism.config import REPO_ROOT

sys.path.insert(0, str(REPO_ROOT / "evaluation"))

from scoring import Counts, format_report, load_labels, score  # noqa: E402

LABELS = {
    "a": {"expected_findings": [{"turn_id": "T4", "category": "identity_dismissal", "identity_characteristic": "age"}]},
    "b": {"expected_findings": []},
    "c": {
        "expected_findings": [],
        "optional_findings": [{"turn_id": "T2", "category": "personal_attack", "identity_characteristic": None}],
    },
    "d": {"expected_findings": [{"turn_id": "T1", "category": "personal_attack", "identity_characteristic": None}]},
}


def finding(turn, category, characteristic=None):
    return {"turn_id": turn, "category": category, "identity_characteristic": characteristic}


def test_matching_by_turn_and_category_with_duplicates_and_optional():
    predictions = {
        "a": [finding("T4", "identity_dismissal", "gender"), finding("t4", "identity_dismissal", "age")],  # duplicate, case-insensitive
        "b": [finding("T1", "personal_attack")],  # false alarm on a clean transcript
        "c": [finding("T2", "personal_attack")],  # optional: neither rewarded nor penalized
        "d": [finding("T1", "identity_dismissal", "age")],  # right turn, wrong category: false alarm + miss
    }
    report = score(predictions, LABELS)
    o = report.overall
    assert (o.correct, o.false_alarms, o.missed, o.optional_matched, o.duplicates_collapsed) == (1, 2, 1, 1, 1)
    assert o.precision == 1 / 3 and o.recall == 1 / 2
    assert report.no_finding_transcripts == 2 and report.false_alarm_transcripts == 1
    a = next(t for t in report.transcripts if t.transcript_id == "a")
    assert a.characteristic_mismatches == ["T4 identity_dismissal: expected age, got gender"]
    assert report.by_category["personal_attack"].missed == 1


def test_zero_denominators_are_none_not_errors():
    empty = Counts()
    assert empty.precision is None and empty.recall is None
    report = score({"b": []}, {"b": {"expected_findings": []}})
    assert report.overall.precision is None and report.overall.recall is None
    assert "n/a" in format_report(report, label_status="synthetic_candidate_requires_human_review", run_info="test")


def test_failed_runs_are_reported_not_dropped():
    report = score({"a": None}, {"a": LABELS["a"]})
    assert report.not_scored == ["a"] and report.overall.missed == 0


def test_candidate_label_files_are_marked_and_cover_required_cases():
    for name, minimum in (("heldout", 15), ("dev", 3)):
        labels, status = load_labels(REPO_ROOT / "evaluation" / name / "labels.candidate.json")
        assert status == "synthetic_candidate_requires_human_review"
        transcripts = {p.stem for p in (REPO_ROOT / "evaluation" / name).glob("*.txt")}
        assert set(labels) == transcripts and len(transcripts) >= minimum
    heldout, _ = load_labels(REPO_ROOT / "evaluation" / "heldout" / "labels.candidate.json")
    covered = {c for label in heldout.values() for c in label["covers"]}
    assert {
        "neutral", "technical_disagreement", "explicit_identity_dismissal", "stereotyping", "personal_attack",
        "quoted_or_rebutted_stereotype", "ambiguous_context", "missing_task_owners", "prompt_injection",
    } <= covered


def test_prompt_freeze_matches_current_instructions():
    from prism.analysis import instruction_fingerprint
    from prism.prompts import load_prompt

    freeze = json.loads((REPO_ROOT / "evaluation" / "prompt_freeze.json").read_text(encoding="utf-8"))
    prompt = load_prompt()
    assert (freeze["prompt_version"], freeze["prompt_sha256"]) == (prompt.version, prompt.sha256)
    assert freeze["instructions_sha256"] == instruction_fingerprint(), (
        "The model instructions (prompt, schema descriptions or message wrapper) changed after they were frozen for "
        "evaluation. Bump PROMPT_VERSION and update evaluation/prompt_freeze.json."
    )


def test_heldout_transcripts_do_not_reuse_prompt_examples():
    import re

    prompt = (REPO_ROOT / "backend" / "prism" / "prompts" / "analysis_v1.md").read_text(encoding="utf-8")

    def grams(text: str, n: int = 4) -> set[str]:
        words = re.findall(r"[a-z']+", text.lower())
        return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}

    examples = set().union(*(grams(example) for example in re.findall(r'"([^"]+)"', prompt)))
    for path in (REPO_ROOT / "evaluation" / "heldout").glob("*.txt"):
        assert not grams(path.read_text(encoding="utf-8")) & examples, f"{path.stem} repeats a prompt example"


def test_unlabeled_outputs_are_listed_and_turn_ids_are_normalized():
    labels = {"a": {"expected_findings": [{"turn_id": " T4 ", "category": "identity_dismissal", "identity_characteristic": "age"}]}}
    report = score({"a": [finding("T4", "identity_dismissal", "gender")], "zzz": [finding("T1", "personal_attack")]}, labels)
    assert report.unlabeled == ["zzz"]
    assert report.transcripts[0].characteristic_mismatches == ["T4 identity_dismissal: expected age, got gender"]
