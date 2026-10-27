"""Pydantic models for the HTTP API and for the model's structured output.

Three groups live here:

* Request/response models for the HTTP API (mirrored in `frontend/src/lib/types.ts`).
* `LLM*` models: the JSON schema the language model must follow. Deterministic
  metrics are deliberately *not* part of this schema; the model never counts.
* Validated analysis models: what the API returns after every quotation has been
  checked against the parsed transcript.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --------------------------------------------------------------------------- #
# Shared vocabulary
# --------------------------------------------------------------------------- #

FindingCategory = Literal["identity_stereotyping", "identity_dismissal", "personal_attack"]
IdentityCharacteristic = Literal[
    "age",
    "gender",
    "race_or_ethnicity",
    "nationality_or_origin",
    "religion",
    "caste",
    "disability",
    "sexual_orientation",
    "other",
]
DecisionStatus = Literal["agreed", "proposed"]
ActionStatus = Literal["committed", "suggested"]
SuggestionBasis = Literal["evidence", "general"]
Mode = Literal["live", "demo"]
Section = Literal["findings", "discussion_points", "decisions", "action_items", "suggestions"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _enum_case(value: object) -> object:
    """Structured outputs may return enum values that differ only in capitalisation; accept them."""
    return value.strip().lower() if isinstance(value, str) else value


# --------------------------------------------------------------------------- #
# Parsing and participation (deterministic, computed in Python)
# --------------------------------------------------------------------------- #


class ParseIssue(BaseModel):
    severity: Literal["error", "warning", "info"]
    code: str
    message: str
    lines: list[int] = Field(default_factory=list, description="1-based line numbers in the canonical transcript")


class Turn(BaseModel):
    turn_id: str
    index: int
    speaker_id: str
    speaker_label: str
    text: str
    word_count: int
    line_start: int
    line_end: int


class SpeakerStats(BaseModel):
    speaker_id: str
    label: str
    order: int
    words: int
    turns: int
    word_share: float | None = Field(description="Fraction of all transcript words (0–1), unrounded; null when the transcript has no words")


class ParseResult(BaseModel):
    ok: bool
    grammar_version: str
    transcript_hash: str
    char_count: int
    line_count: int
    total_words: int
    total_turns: int
    speakers: list[SpeakerStats]
    turns: list[Turn]
    issues: list[ParseIssue]


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #


class ParseRequest(_Strict):
    transcript: str


class AnalyzeRequest(_Strict):
    transcript: str
    mode: Mode
    analysis_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    sample_id: str | None = Field(default=None, pattern=r"^[a-z0-9-]{1,64}$")


# --------------------------------------------------------------------------- #
# Model output schema (sent to the provider as a JSON schema)
# --------------------------------------------------------------------------- #

_QUOTE_RULE = (
    "Exact contiguous substring of that turn's text, copied character-for-character. "
    "No added quotation marks, no ellipses, no edits, no text from other turns."
)


class LLMSourceRef(_Strict):
    turn_id: str = Field(description="ID of the turn containing the quote, for example T4.")
    quote: str = Field(description=_QUOTE_RULE)


class LLMFinding(_Strict):
    turn_id: str = Field(description="ID of the turn where the quoted words appear.")
    quote: str = Field(description="Shortest span that shows the issue. " + _QUOTE_RULE)
    category: FindingCategory
    identity_characteristic: IdentityCharacteristic | None = Field(
        description="Identity characteristic explicitly referenced in the text. Null for personal_attack. Never inferred from names."
    )
    explanation: str = Field(description="One or two sentences describing what the words do. No claims about intent or character.")
    context_note: str | None = Field(description="Null, or one sentence on context that affects interpretation (quoted speech, sarcasm, uncertainty).")
    alternative_wording: str = Field(
        description="Newly written alternative that keeps any legitimate point. Use [bracketed placeholders] for reasons the speaker did not state."
    )

    _enums = field_validator("category", "identity_characteristic", mode="before")(_enum_case)


class LLMDiscussionPoint(_Strict):
    point: str
    sources: list[LLMSourceRef] = Field(min_length=1)


class LLMDecision(_Strict):
    decision: str
    status: DecisionStatus = Field(description="agreed only when participants explicitly agreed or the decision-maker confirmed.")
    sources: list[LLMSourceRef] = Field(min_length=1)

    _enums = field_validator("status", mode="before")(_enum_case)


class LLMActionItem(_Strict):
    task: str
    owner: str | None = Field(description="Name exactly as it appears in the transcript, or null. Never guess.")
    deadline: str | None = Field(description="Deadline exactly as stated (keep relative phrases as written), or null.")
    status: ActionStatus = Field(description="committed when a person accepted or was assigned without objection; suggested otherwise.")
    sources: list[LLMSourceRef] = Field(min_length=1)

    _enums = field_validator("status", mode="before")(_enum_case)


class LLMSuggestion(_Strict):
    suggestion: str
    basis: SuggestionBasis = Field(description="evidence when tied to a finding or cited turns; general for general guidance.")
    finding_index: int | None = Field(description="0-based index into findings when the suggestion addresses a finding; otherwise null.")
    sources: list[LLMSourceRef] = Field(description="Supporting turns for evidence-based suggestions; empty for general guidance.")

    _enums = field_validator("basis", mode="before")(_enum_case)


class LLMAnalysis(_Strict):
    findings: list[LLMFinding]
    discussion_points: list[LLMDiscussionPoint]
    decisions: list[LLMDecision]
    action_items: list[LLMActionItem]
    suggestions: list[LLMSuggestion]


# --------------------------------------------------------------------------- #
# Validated analysis (returned to the browser)
# --------------------------------------------------------------------------- #


class Highlight(BaseModel):
    """Location of a verified quotation inside `Turn.text`.

    Offsets are UTF-16 code units, the unit JavaScript string indices use, so
    `turn.text.slice(start, end)` in the browser returns the quotation even when
    the text contains emoji or other characters outside the Basic Multilingual Plane.
    When the quotation occurs more than once in the turn, the first occurrence is used.
    """

    start: int
    end: int
    occurrences: int


class Evidence(BaseModel):
    turn_id: str
    speaker_id: str
    speaker_label: str
    quote: str = Field(description="The transcript's own text for the verified span")
    highlight: Highlight


class Finding(BaseModel):
    finding_id: str
    category: FindingCategory
    identity_characteristic: IdentityCharacteristic | None
    evidence: Evidence
    explanation: str
    context_note: str | None
    alternative_wording: str


class DiscussionPoint(BaseModel):
    item_id: str
    text: str
    sources: list[Evidence]


class Decision(BaseModel):
    item_id: str
    text: str
    status: DecisionStatus
    sources: list[Evidence]


class ActionItem(BaseModel):
    item_id: str
    task: str
    owner: str | None
    deadline: str | None
    status: ActionStatus
    sources: list[Evidence]


class Suggestion(BaseModel):
    item_id: str
    text: str
    basis: SuggestionBasis
    related_finding_id: str | None
    sources: list[Evidence]


class AnalysisContent(BaseModel):
    findings: list[Finding]
    discussion_points: list[DiscussionPoint]
    decisions: list[Decision]
    action_items: list[ActionItem]
    suggestions: list[Suggestion]


class ValidationNotice(BaseModel):
    section: Section
    code: str
    count: int
    message: str


class AnalyzeResponse(BaseModel):
    analysis_id: str
    mode: Mode
    sample_id: str | None
    model: str | None
    prompt_version: str
    generated_at: str
    transcript_hash: str
    attempts: int = Field(description="Model requests made for this analysis (0 in demo mode)")
    findings_returned: int = Field(description="Findings in the raw model output before validation")
    parse: ParseResult
    analysis: AnalysisContent
    notices: list[ValidationNotice]


# --------------------------------------------------------------------------- #
# Service metadata
# --------------------------------------------------------------------------- #


class Limits(BaseModel):
    max_transcript_chars: int
    max_upload_bytes: int


class LiveStatus(BaseModel):
    available: bool
    model: str | None
    effort: str | None
    missing: list[str]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    app_version: str
    prompt_version: str
    grammar_version: str
    live: LiveStatus
    limits: Limits
    request_timeout_seconds: int


class SampleInfo(BaseModel):
    sample_id: str
    title: str
    description: str
    transcript: str
    demo_available: bool


class ErrorBody(BaseModel):
    code: str
    message: str
    retry_after_seconds: int | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody
