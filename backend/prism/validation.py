"""Evidence validation: the gate between model output and what the user sees.

Rules for every quotation (findings and source references alike):

1. The cited turn must exist (turn IDs are matched case-insensitively: "t4" == "T4").
2. The quotation, trimmed, must be non-empty, contain a letter or digit, and occur
   verbatim inside *that* turn's text. A match in another turn is rejected.
3. Matching is exact except for one documented, length-preserving equivalence:
   curly quotes/apostrophes match straight ones, and any whitespace character
   matches any other single whitespace character. No fuzzy matching.
4. The displayed quotation is always the transcript's own text for the span, and
   the speaker is always taken from the parsed turn, never from the model.
5. Repeated substrings: the first occurrence in the turn is highlighted and the
   number of occurrences is reported.

"Quotation verified" means the words exist where cited. It does not mean the
model's interpretation is correct.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .schemas import (
    ActionItem,
    AnalysisContent,
    Decision,
    DiscussionPoint,
    Evidence,
    Finding,
    Highlight,
    LLMAnalysis,
    LLMSourceRef,
    ParseResult,
    Section,
    Suggestion,
    Turn,
    ValidationNotice,
)

_QUOTE_EQUIVALENTS = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201b": "'", "\u201c": '"', "\u201d": '"'})
_OWNER_SEPARATORS = re.compile(r"\s*(?:,|&|/|\band\b)\s*", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Quote matching
# --------------------------------------------------------------------------- #


def match_form(text: str) -> str:
    """Length-preserving comparison form (see rule 3 above)."""
    translated = text.translate(_QUOTE_EQUIVALENTS)
    return "".join(" " if ch.isspace() else ch for ch in translated)


@dataclass(frozen=True)
class QuoteMatch:
    start: int  # code-point index into the turn text
    end: int
    exact: str
    occurrences: int


def locate_quote(turn_text: str, quote: str) -> QuoteMatch | None:
    needle = quote.strip()
    if not needle or not any(ch.isalnum() for ch in needle):
        return None
    haystack = match_form(turn_text)
    target = match_form(needle)
    start = haystack.find(target)
    if start < 0:
        return None
    occurrences, cursor = 0, start
    while cursor >= 0:
        occurrences += 1
        cursor = haystack.find(target, cursor + len(target))
    end = start + len(target)
    return QuoteMatch(start=start, end=end, exact=turn_text[start:end], occurrences=occurrences)


def utf16_offset(text: str, index: int) -> int:
    """Convert a code-point index to a UTF-16 code-unit index (JavaScript string index)."""
    return len(text[:index].encode("utf-16-le", "surrogatepass")) // 2


def _evidence(turn: Turn, match: QuoteMatch) -> Evidence:
    return Evidence(
        turn_id=turn.turn_id,
        speaker_id=turn.speaker_id,
        speaker_label=turn.speaker_label,
        quote=match.exact,
        highlight=Highlight(
            start=utf16_offset(turn.text, match.start),
            end=utf16_offset(turn.text, match.end),
            occurrences=match.occurrences,
        ),
    )


# --------------------------------------------------------------------------- #
# Notices
# --------------------------------------------------------------------------- #

_SECTION_NOUNS: dict[Section, tuple[str, str]] = {
    "findings": ("finding", "findings"),
    "discussion_points": ("discussion point", "discussion points"),
    "decisions": ("decision", "decisions"),
    "action_items": ("action item", "action items"),
    "suggestions": ("suggestion", "suggestions"),
}


def _noun(section: Section, count: int) -> str:
    singular, plural = _SECTION_NOUNS[section]
    return f"{count} {singular if count == 1 else plural}"


def _notice_message(section: Section, code: str, count: int) -> str:
    items = _noun(section, count)
    was = "was" if count == 1 else "were"
    messages = {
        "unknown_turn": f"{items} cited a turn that does not exist and {was} omitted.",
        "quote_not_found": f"{items} {was} omitted because the quotation was not found word-for-word in the cited turn.",
        "wrong_turn": f"{items} {was} omitted because the quotation appears in a different turn than the one cited (possible misattribution).",
        "duplicate": f"{items} repeating the same evidence and category {was} merged.",
        "no_verified_source": f"{items} {was} omitted because none of the supporting quotations could be verified.",
        "source_removed": (
            f"{count} unverifiable source {'reference was' if count == 1 else 'references were'} removed; "
            "the affected items are shown with their verified sources only."
        ),
        "owner_removed": (
            f"{count} owner {'name was' if count == 1 else 'names were'} removed because "
            f"{'it does' if count == 1 else 'they do'} not appear in the cited turns; shown as “Not specified”."
        ),
        "deadline_removed": (
            f"{count} {'deadline was' if count == 1 else 'deadlines were'} removed because "
            f"{'it does' if count == 1 else 'they do'} not appear in the cited turns; shown as “Not specified”."
        ),
        "unsupported": f"{items} {was} omitted because the evidence or finding they referred to could not be verified.",
        "link_removed": f"{count} {'link' if count == 1 else 'links'} to omitted findings {was} removed from suggestions.",
        "duplicate_item": f"{items} with identical wording {was} removed.",
    }
    return messages[code]


class _Notices:
    def __init__(self) -> None:
        self._counts: Counter[tuple[Section, str]] = Counter()

    def add(self, section: Section, code: str, count: int = 1) -> None:
        if count:
            self._counts[(section, code)] += count

    def build(self) -> list[ValidationNotice]:
        return [
            ValidationNotice(section=section, code=code, count=count, message=_notice_message(section, code, count))
            for (section, code), count in self._counts.items()
        ]


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


class EvidenceValidator:
    def __init__(self, parsed: ParseResult) -> None:
        self.turns = parsed.turns
        self.turns_by_id = {turn.turn_id.upper(): turn for turn in parsed.turns}

    def check(self, turn_id: str, quote: str) -> tuple[Evidence | None, str | None]:
        """Return (evidence, None) when verified, otherwise (None, reason code)."""
        turn = self.turns_by_id.get(turn_id.strip().upper())
        if turn is None:
            return None, "unknown_turn"
        match = locate_quote(turn.text, quote)
        if match is not None:
            return _evidence(turn, match), None
        # Diagnostic only: a match elsewhere is never accepted as evidence.
        for other in self.turns:
            if other.turn_id != turn.turn_id and locate_quote(other.text, quote) is not None:
                return None, "wrong_turn"
        return None, "quote_not_found"

    def check_sources(self, refs: list[LLMSourceRef]) -> tuple[list[Evidence], int]:
        verified: list[Evidence] = []
        seen: set[tuple[str, int, int]] = set()
        rejected = 0
        for ref in refs:
            evidence, _reason = self.check(ref.turn_id, ref.quote)
            if evidence is None:
                rejected += 1
                continue
            key = (evidence.turn_id, evidence.highlight.start, evidence.highlight.end)
            if key not in seen:
                seen.add(key)
                verified.append(evidence)
        return verified, rejected

    def find_phrase(self, phrase: str, sources: list[Evidence]) -> str | None:
        """The transcript's own spelling of `phrase` when it occurs as a whole word or phrase in a cited turn.

        Matching is whole-word ("Ann" never matches inside "planning") and case-sensitive.
        Phrases of two or more words may also match ignoring case ("Next Friday" finds
        "next Friday"); single words may not, so "May" or "Will" cannot be borrowed from
        the ordinary words "may" and "will".
        """
        target = match_form(phrase.strip())
        if not target or not any(ch.isalnum() for ch in target):
            return None
        body = r"(?<!\w)" + re.escape(target) + r"(?!\w)"
        patterns = [re.compile(body)]
        if len(target.split()) >= 2:
            patterns.append(re.compile(body, re.IGNORECASE))
        for pattern in patterns:
            for evidence in sources:
                text = self.turns_by_id[evidence.turn_id.upper()].text
                found = pattern.search(match_form(text))  # match_form is length-preserving
                if found:
                    return text[found.start() : found.end()]
        return None

    def resolve_owner(self, owner: str, sources: list[Evidence]) -> str | None:
        """Keep an owner only if every named person is the speaker of a cited turn or is named in one.

        Returns the owner spelled as in the transcript, or None when any part is unsupported.
        """
        parts = [part.strip() for part in _OWNER_SEPARATORS.split(owner) if part.strip()]
        if not parts:
            return None
        cited_speakers = {match_form(e.speaker_label).casefold(): e.speaker_label for e in sources}
        resolved = owner.strip()
        for part in parts:
            canonical = cited_speakers.get(match_form(part).casefold()) or self.find_phrase(part, sources)
            if canonical is None:
                return None
            resolved = resolved.replace(part, canonical, 1)
        return resolved

    def resolve_deadline(self, deadline: str, sources: list[Evidence]) -> str | None:
        """Keep a deadline only if it is stated in a cited turn; return it exactly as written there."""
        return self.find_phrase(deadline, sources)


def _overlaps(a: Highlight, b: Highlight) -> bool:
    return a.start < b.end and b.start < a.end


def _text_key(text: str) -> str:
    return " ".join(match_form(text).casefold().split())


def validate_analysis(output: LLMAnalysis, parsed: ParseResult) -> tuple[AnalysisContent, list[ValidationNotice]]:
    validator = EvidenceValidator(parsed)
    notices = _Notices()

    # ---- findings --------------------------------------------------------- #
    findings: list[Finding] = []
    finding_ids_by_index: dict[int, str] = {}
    for index, raw in enumerate(output.findings):
        evidence, reason = validator.check(raw.turn_id, raw.quote)
        if evidence is None:
            notices.add("findings", reason or "quote_not_found")
            continue
        duplicate_of = next(
            (
                existing
                for existing in findings
                if existing.category == raw.category
                and existing.evidence.turn_id == evidence.turn_id
                and _overlaps(existing.evidence.highlight, evidence.highlight)
            ),
            None,
        )
        if duplicate_of is not None:
            notices.add("findings", "duplicate")
            finding_ids_by_index[index] = duplicate_of.finding_id
            continue
        characteristic = None if raw.category == "personal_attack" else raw.identity_characteristic
        finding = Finding(
            finding_id=f"F{len(findings) + 1}",
            category=raw.category,
            identity_characteristic=characteristic,
            evidence=evidence,
            explanation=raw.explanation.strip(),
            context_note=(raw.context_note or "").strip() or None,
            alternative_wording=raw.alternative_wording.strip(),
        )
        findings.append(finding)
        finding_ids_by_index[index] = finding.finding_id

    # ---- discussion points, decisions ------------------------------------- #
    def sourced(section: Section, refs: list[LLMSourceRef]) -> list[Evidence] | None:
        verified, rejected = validator.check_sources(refs)
        if not verified:
            notices.add(section, "no_verified_source")
            return None
        notices.add(section, "source_removed", rejected)
        return verified

    points: list[DiscussionPoint] = []
    seen_points: set[str] = set()
    for raw_point in output.discussion_points:
        key = _text_key(raw_point.point)
        if key in seen_points:
            notices.add("discussion_points", "duplicate_item")
            continue
        sources = sourced("discussion_points", raw_point.sources)
        if sources is None:
            continue
        seen_points.add(key)
        points.append(DiscussionPoint(item_id=f"P{len(points) + 1}", text=raw_point.point.strip(), sources=sources))

    decisions: list[Decision] = []
    seen_decisions: set[str] = set()
    for raw_decision in output.decisions:
        key = _text_key(raw_decision.decision)
        if key in seen_decisions:
            notices.add("decisions", "duplicate_item")
            continue
        sources = sourced("decisions", raw_decision.sources)
        if sources is None:
            continue
        seen_decisions.add(key)
        decisions.append(
            Decision(item_id=f"D{len(decisions) + 1}", text=raw_decision.decision.strip(), status=raw_decision.status, sources=sources)
        )

    # ---- action items ----------------------------------------------------- #
    actions: list[ActionItem] = []
    seen_actions: set[str] = set()
    for raw_action in output.action_items:
        key = _text_key(raw_action.task)
        if key in seen_actions:
            notices.add("action_items", "duplicate_item")
            continue
        sources = sourced("action_items", raw_action.sources)
        if sources is None:
            continue
        seen_actions.add(key)
        owner = (raw_action.owner or "").strip() or None
        if owner is not None:
            owner = validator.resolve_owner(owner, sources)
            if owner is None:
                notices.add("action_items", "owner_removed")
        deadline = (raw_action.deadline or "").strip() or None
        if deadline is not None:
            deadline = validator.resolve_deadline(deadline, sources)
            if deadline is None:
                notices.add("action_items", "deadline_removed")
        actions.append(
            ActionItem(
                item_id=f"A{len(actions) + 1}",
                task=raw_action.task.strip(),
                owner=owner,
                deadline=deadline,
                status=raw_action.status,
                sources=sources,
            )
        )

    # ---- suggestions ------------------------------------------------------ #
    suggestions: list[Suggestion] = []
    seen_suggestions: set[str] = set()
    for raw_suggestion in output.suggestions:
        key = _text_key(raw_suggestion.suggestion)
        if key in seen_suggestions:
            notices.add("suggestions", "duplicate_item")
            continue
        if raw_suggestion.basis == "general":
            seen_suggestions.add(key)
            suggestions.append(
                Suggestion(
                    item_id=f"S{len(suggestions) + 1}",
                    text=raw_suggestion.suggestion.strip(),
                    basis="general",
                    related_finding_id=None,
                    sources=[],
                )
            )
            continue
        verified, rejected = validator.check_sources(raw_suggestion.sources)
        related: str | None = None
        if raw_suggestion.finding_index is not None:
            related = finding_ids_by_index.get(raw_suggestion.finding_index)
            if related is None:
                notices.add("suggestions", "link_removed")
        if not verified and related is None:
            notices.add("suggestions", "unsupported")
            continue
        notices.add("suggestions", "source_removed", rejected)
        seen_suggestions.add(key)
        suggestions.append(
            Suggestion(
                item_id=f"S{len(suggestions) + 1}",
                text=raw_suggestion.suggestion.strip(),
                basis="evidence",
                related_finding_id=related,
                sources=verified,
            )
        )

    content = AnalysisContent(
        findings=findings,
        discussion_points=points,
        decisions=decisions,
        action_items=actions,
        suggestions=suggestions,
    )
    return content, notices.build()
