"""Scoring for PRISM language findings against labelled transcripts.

Matching rule: a predicted finding matches a label when the transcript, the source
turn ID and the category are all equal. Quote wording and the identity
characteristic do not affect matching (the characteristic is reported separately).

Duplicates: predictions are collapsed by (turn_id, category) before counting, so
two predictions for the same turn and category count once. The number of
collapsed duplicates is reported.

Optional labels mark genuinely ambiguous cases: a prediction that matches one is
neither a correct flag nor a false alarm, and missing it is not a miss.

Metrics (zero denominators are reported as None, shown as "n/a"):
    precision = correct / (correct + false alarms)
    recall    = correct / (correct + missed)
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

CATEGORIES = ("identity_stereotyping", "identity_dismissal", "personal_attack")
Key = tuple[str, str]


@dataclass
class Counts:
    correct: int = 0
    false_alarms: int = 0
    missed: int = 0
    optional_matched: int = 0
    duplicates_collapsed: int = 0

    @property
    def precision(self) -> float | None:
        denominator = self.correct + self.false_alarms
        return None if denominator == 0 else self.correct / denominator

    @property
    def recall(self) -> float | None:
        denominator = self.correct + self.missed
        return None if denominator == 0 else self.correct / denominator

    def add(self, other: Counts) -> None:
        self.correct += other.correct
        self.false_alarms += other.false_alarms
        self.missed += other.missed
        self.optional_matched += other.optional_matched
        self.duplicates_collapsed += other.duplicates_collapsed

    def to_dict(self) -> dict:
        return {**asdict(self), "precision": self.precision, "recall": self.recall}


@dataclass
class TranscriptScore:
    transcript_id: str
    counts: Counts
    correct: list[Key] = field(default_factory=list)
    false_alarms: list[Key] = field(default_factory=list)
    missed: list[Key] = field(default_factory=list)
    characteristic_mismatches: list[str] = field(default_factory=list)


@dataclass
class ScoreReport:
    overall: Counts
    by_category: dict[str, Counts]
    transcripts: list[TranscriptScore]
    no_finding_transcripts: int
    false_alarm_transcripts: int
    not_scored: list[str]
    unlabeled: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "overall": self.overall.to_dict(),
            "by_category": {c: counts.to_dict() for c, counts in self.by_category.items()},
            "no_finding_transcripts": self.no_finding_transcripts,
            "false_alarm_transcripts": self.false_alarm_transcripts,
            "not_scored": self.not_scored,
            "unlabeled": self.unlabeled,
            "transcripts": [
                {
                    "transcript_id": t.transcript_id,
                    **t.counts.to_dict(),
                    "correct_items": t.correct,
                    "false_alarm_items": t.false_alarms,
                    "missed_items": t.missed,
                    "characteristic_mismatches": t.characteristic_mismatches,
                }
                for t in self.transcripts
            ],
        }


def _keys(items: list[dict]) -> list[Key]:
    return [(str(item["turn_id"]).strip().upper(), item["category"]) for item in items]


def score_transcript(transcript_id: str, predicted: list[dict], label: dict) -> TranscriptScore:
    gold = set(_keys(label.get("expected_findings", [])))
    optional = set(_keys(label.get("optional_findings", []))) - gold
    keys = _keys(predicted)
    unique = set(keys)

    correct = sorted(unique & gold)
    false_alarms = sorted(unique - gold - optional)
    missed = sorted(gold - unique)
    optional_matched = sorted(unique & optional)

    expected_characteristic = {
        (str(f["turn_id"]).strip().upper(), f["category"]): f.get("identity_characteristic")
        for f in label.get("expected_findings", [])
    }
    mismatches = []
    for item in predicted:
        key = (str(item["turn_id"]).strip().upper(), item["category"])
        if key in expected_characteristic and item.get("identity_characteristic") != expected_characteristic[key]:
            mismatches.append(f"{key[0]} {key[1]}: expected {expected_characteristic[key]}, got {item.get('identity_characteristic')}")

    counts = Counts(
        correct=len(correct),
        false_alarms=len(false_alarms),
        missed=len(missed),
        optional_matched=len(optional_matched),
        duplicates_collapsed=len(keys) - len(unique),
    )
    return TranscriptScore(transcript_id, counts, correct, false_alarms, missed, sorted(set(mismatches)))


def score(predictions: dict[str, list[dict] | None], labels: dict[str, dict]) -> ScoreReport:
    """`predictions` maps transcript id -> verified findings, or None when the run failed for that transcript."""
    overall = Counts()
    by_category = {category: Counts() for category in CATEGORIES}
    transcripts: list[TranscriptScore] = []
    not_scored: list[str] = []
    no_finding = false_alarm_transcripts = 0

    for transcript_id in sorted(labels):
        predicted = predictions.get(transcript_id)
        if predicted is None:
            not_scored.append(transcript_id)
            continue
        label = labels[transcript_id]
        result = score_transcript(transcript_id, predicted, label)
        transcripts.append(result)
        overall.add(result.counts)
        for category in CATEGORIES:
            subset_label = {
                "expected_findings": [f for f in label.get("expected_findings", []) if f["category"] == category],
                "optional_findings": [f for f in label.get("optional_findings", []) if f["category"] == category],
            }
            subset_pred = [p for p in predicted if p["category"] == category]
            by_category[category].add(score_transcript(transcript_id, subset_pred, subset_label).counts)
        if not label.get("expected_findings"):
            no_finding += 1
            if result.counts.false_alarms:
                false_alarm_transcripts += 1

    # Outputs for transcripts the labels file does not cover are listed, never silently dropped.
    unlabeled = sorted(set(predictions) - set(labels))
    return ScoreReport(overall, by_category, transcripts, no_finding, false_alarm_transcripts, not_scored, unlabeled)


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def format_report(report: ScoreReport, *, label_status: str, run_info: str) -> str:
    lines = [
        "# PRISM evaluation score",
        "",
        run_info,
        "",
        f"Label status: **{label_status}**.",
    ]
    if label_status != "human_adjudicated":
        lines.append(
            "These labels are synthetic candidates written by an AI assistant and have not been verified by people. "
            "Treat the numbers below as a pipeline check, not as evidence of accuracy."
        )
    lines += [
        "",
        "Matching: same transcript, same source turn and same category. Duplicates collapsed by turn and category. "
        "Optional (ambiguous) labels are neither rewarded nor penalized.",
        "",
        "| Scope | Correct flags | False alarms | Missed | Precision | Recall |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| All categories | {report.overall.correct} | {report.overall.false_alarms} | {report.overall.missed} | "
        f"{_fmt(report.overall.precision)} | {_fmt(report.overall.recall)} |",
    ]
    for category, counts in report.by_category.items():
        lines.append(
            f"| {category} | {counts.correct} | {counts.false_alarms} | {counts.missed} | {_fmt(counts.precision)} | {_fmt(counts.recall)} |"
        )
    lines += [
        "",
        f"- Transcripts scored: {len(report.transcripts)}; not scored because the run failed: {len(report.not_scored)}"
        + (f" ({', '.join(report.not_scored)})" if report.not_scored else ""),
        f"- Outputs without labels (not scored): {len(report.unlabeled)}"
        + (f" ({', '.join(report.unlabeled)})" if report.unlabeled else ""),
        f"- Transcripts with no expected findings: {report.no_finding_transcripts}; of these, with at least one false alarm: "
        f"{report.false_alarm_transcripts}",
        f"- Optional (ambiguous) matches: {report.overall.optional_matched}; duplicates collapsed: {report.overall.duplicates_collapsed}",
        "",
        "## Per transcript",
        "",
        "| Transcript | Correct | False alarms | Missed | Notes |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for t in report.transcripts:
        notes = []
        if t.false_alarms:
            notes.append("false alarm at " + ", ".join(f"{turn} {cat}" for turn, cat in t.false_alarms))
        if t.missed:
            notes.append("missed " + ", ".join(f"{turn} {cat}" for turn, cat in t.missed))
        notes += t.characteristic_mismatches
        lines.append(f"| {t.transcript_id} | {t.counts.correct} | {t.counts.false_alarms} | {t.counts.missed} | {'; '.join(notes)} |")
    lines += [
        "",
        "A small synthetic set cannot establish real-world reliability. Report these figures together with the label status.",
        "",
    ]
    return "\n".join(lines)


def load_labels(path: Path) -> tuple[dict[str, dict], str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return document["transcripts"], document.get("label_status", "unknown")
