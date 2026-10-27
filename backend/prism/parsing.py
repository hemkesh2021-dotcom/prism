"""Transcript grammar (version 1).

1. Canonical form: one leading UTF-8 BOM (U+FEFF) is removed and CRLF, lone CR and
   the Unicode line separators U+2028, U+2029 and NEL become LF. Limits, hashing,
   parsing and evidence checks all use this text.
2. A line starts a turn when its *first* colon is followed by whitespace or the
   end of the line, and the text before that colon (trimmed) is a valid speaker
   label. Everything after the separator is the message; later colons are kept.
3. Valid label: 1–40 characters, at most 5 words, starts with a letter, and
   contains only letters, digits, spaces and . ' ’ - _ ( ).
4. Any other non-blank line continues the previous turn (joined with a newline).
   Blank lines are skipped. A non-blank line before the first labeled line is an error.
5. Labels are trimmed but never merged: "Arun", "arun" and "Arun K" are
   different speakers. Similar labels produce a warning instead.

Timestamped formats such as "[10:02] Arun: ..." are outside this grammar.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

from .config import Settings
from .errors import PrismError
from .metrics import compute_participation, count_words
from .schemas import ParseIssue, ParseResult, Turn

GRAMMAR_VERSION = "1"
MAX_LABEL_CHARS = 40
MAX_LABEL_WORDS = 5

_LABEL_EXTRA_CHARS = frozenset(" .'’-_()")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_HEADING_WORDS = frozenset(
    {
        "action item", "action items", "actions", "agenda", "attendees", "date", "decision",
        "decisions", "fwd", "fyi", "location", "minutes", "note", "notes", "ps", "re",
        "reminder", "subject", "summary", "time", "to do", "todo", "topic", "update", "updates",
    }
)
_MAX_LINES_LISTED = 8


# --------------------------------------------------------------------------- #
# Canonical form and input checks
# --------------------------------------------------------------------------- #


_LINE_BREAKS = re.compile("\r\n|[\r\u2028\u2029\x85]")


def canonicalize(raw: str) -> str:
    """Drop one leading BOM; turn CRLF, CR and Unicode line/paragraph separators (U+2028, U+2029, NEL) into LF."""
    text = raw[1:] if raw.startswith("\ufeff") else raw
    return _LINE_BREAKS.sub("\n", text)


def transcript_hash(canonical: str) -> str:
    return hashlib.sha256(canonical.encode("utf-8", "surrogatepass")).hexdigest()


def check_transcript_input(canonical: str, settings: Settings) -> None:
    """Reject input the app cannot analyze. Never truncates."""
    try:
        encoded = canonical.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise PrismError(
            "unsupported_encoding",
            "The transcript contains characters that are not valid Unicode text. Re-save the file as UTF-8 plain text.",
            status=422,
        ) from exc
    control = _CONTROL_CHARS.search(canonical)
    if control:
        raise PrismError(
            "unsupported_encoding",
            f"The transcript contains a control character (U+{ord(control.group()):04X}), which usually means a binary "
            "or non-text file. Paste plain text or upload a UTF-8 .txt file.",
            status=422,
        )
    if not canonical.strip():
        raise PrismError("transcript_empty", "The transcript is empty. Paste or upload a meeting transcript first.", status=422)
    if len(canonical) > settings.max_transcript_chars:
        raise PrismError(
            "transcript_too_long",
            f"The transcript has {len(canonical):,} characters; the limit is {settings.max_transcript_chars:,}. "
            "Split the meeting into parts or remove unrelated text. Nothing was truncated.",
            status=413,
        )
    if len(encoded) > settings.max_upload_bytes:
        raise PrismError(
            "transcript_too_large",
            f"The transcript is {len(encoded) / 1024:,.0f} KiB; the limit is {settings.max_upload_bytes / 1024:,.0f} KiB.",
            status=413,
        )


# --------------------------------------------------------------------------- #
# Grammar
# --------------------------------------------------------------------------- #


def is_valid_label(label: str) -> bool:
    if not 1 <= len(label) <= MAX_LABEL_CHARS:
        return False
    if not label[0].isalpha():
        return False
    for ch in label:
        if ch.isalnum() or ch in _LABEL_EXTRA_CHARS or unicodedata.category(ch).startswith("M"):
            continue
        return False
    return len(label.split()) <= MAX_LABEL_WORDS


def split_labeled_line(line: str) -> tuple[str, str] | None:
    """Return (label, message) if the line starts a turn, otherwise None."""
    colon = line.find(":")
    if colon <= 0:
        return None
    following = line[colon + 1 : colon + 2]
    if following and not following.isspace():
        return None
    label = line[:colon].strip()
    if not is_valid_label(label):
        return None
    return label, line[colon + 1 :].strip()


def _missing_space_after_colon(line: str) -> bool:
    colon = line.find(":")
    if colon <= 0:
        return False
    following = line[colon + 1 : colon + 2]
    return following.isalpha() and is_valid_label(line[:colon].strip())


def _label_key(label: str) -> str:
    """Comparison key used only to *warn* about labels that may be the same person."""
    stripped = "".join(ch for ch in label.casefold() if ch not in ".'’-_()")
    return " ".join(stripped.split())


def _format_lines(lines: list[int]) -> str:
    shown = ", ".join(str(n) for n in lines[:_MAX_LINES_LISTED])
    extra = len(lines) - _MAX_LINES_LISTED
    return f"{shown} and {extra} more" if extra > 0 else shown


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return singular if count == 1 else (plural or singular + "s")


def parse_transcript(raw: str) -> ParseResult:
    """Parse a transcript and compute deterministic participation statistics.

    Input limits are checked separately by `check_transcript_input`.
    """
    canonical = canonicalize(raw)
    lines = canonical.split("\n")
    issues: list[ParseIssue] = []

    pending: list[dict] = []
    orphan_lines: list[int] = []
    continuation_lines: list[int] = []
    missing_space_lines: list[int] = []

    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        labeled = split_labeled_line(line)
        if labeled is not None:
            label, message = labeled
            pending.append({"label": label, "parts": [message] if message else [], "start": number, "end": number})
            continue
        if _missing_space_after_colon(line):
            missing_space_lines.append(number)
        if not pending:
            orphan_lines.append(number)
            continue
        pending[-1]["parts"].append(line.strip())
        pending[-1]["end"] = number
        continuation_lines.append(number)

    speaker_ids: dict[str, str] = {}
    turns: list[Turn] = []
    for index, item in enumerate(pending):
        label = item["label"]
        if label not in speaker_ids:
            speaker_ids[label] = f"S{len(speaker_ids) + 1}"
        text = "\n".join(item["parts"])
        turns.append(
            Turn(
                turn_id=f"T{index + 1}",
                index=index,
                speaker_id=speaker_ids[label],
                speaker_label=label,
                text=text,
                word_count=count_words(text),
                line_start=item["start"],
                line_end=item["end"],
            )
        )

    speaker_order = [(sid, label) for label, sid in speaker_ids.items()]
    speakers, total_words = compute_participation(turns, speaker_order)

    # ---- errors ----------------------------------------------------------- #
    if not canonical.strip():
        issues.append(ParseIssue(severity="error", code="transcript_empty", message="The transcript is empty."))
    if orphan_lines:
        first = orphan_lines[0]
        issues.append(
            ParseIssue(
                severity="error",
                code="text_before_first_speaker",
                message=(
                    f"Line {first} has text before the first speaker label. Every turn must start with "
                    "“Speaker: Message”; add a label or delete the line."
                ),
                lines=orphan_lines,
            )
        )
    if canonical.strip() and not turns:
        issues.append(
            ParseIssue(
                severity="error",
                code="no_speaker_lines",
                message="No line matches “Speaker: Message”. Put each speaker label at the start of a line, followed by a colon and a space.",
            )
        )

    # ---- warnings --------------------------------------------------------- #
    if missing_space_lines:
        issues.append(
            ParseIssue(
                severity="warning",
                code="missing_space_after_colon",
                message=(
                    f"{_plural(len(missing_space_lines), 'Line', 'Lines')} {_format_lines(missing_space_lines)} "
                    "look like “Speaker:Message” without a space after the colon, so they were not read as new turns. "
                    "Add a space after the colon if a new speaker starts there."
                ),
                lines=missing_space_lines,
            )
        )

    groups: dict[str, list[str]] = {}
    for label in speaker_ids:
        groups.setdefault(_label_key(label), []).append(label)
    for labels in groups.values():
        if len(labels) > 1:
            quoted = ", ".join(f"“{label}”" for label in labels)
            issues.append(
                ParseIssue(
                    severity="warning",
                    code="similar_speaker_labels",
                    message=(
                        f"Speaker labels {quoted} differ only in spelling, spacing or capitalization. They are counted as "
                        "separate speakers; edit the transcript if they are the same person."
                    ),
                )
            )

    label_counts: dict[str, int] = {}
    for item in pending:
        label_counts[item["label"]] = label_counts.get(item["label"], 0) + 1
    for label in speaker_ids:
        words = label.split()
        sentence_like = len(words) >= 2 and any(word[0].islower() for word in words[1:] if word[0].isalpha())
        if label_counts[label] == 1 and sentence_like and " ".join(label.casefold().split()) not in _HEADING_WORDS:
            issues.append(
                ParseIssue(
                    severity="warning",
                    code="label_looks_like_text",
                    message=(
                        f"“{label}” appears once as a speaker label but reads like part of a sentence. If that line "
                        "continues the previous turn, remove its colon so it is not split into a new turn."
                    ),
                )
            )
    for label in speaker_ids:
        if " ".join(label.casefold().split()) in _HEADING_WORDS:
            issues.append(
                ParseIssue(
                    severity="warning",
                    code="heading_like_label",
                    message=f"“{label}” is being treated as a speaker. If it is a heading, remove its colon or delete the line.",
                )
            )

    empty_turns = [t for t in turns if not t.text.strip()]
    if empty_turns:
        ids = ", ".join(t.turn_id for t in empty_turns[:_MAX_LINES_LISTED])
        issues.append(
            ParseIssue(
                severity="warning",
                code="empty_turn",
                message=f"{len(empty_turns)} {_plural(len(empty_turns), 'turn has', 'turns have')} no message text ({ids}). "
                "They count as turns with zero words.",
                lines=[t.line_start for t in empty_turns],
            )
        )

    if turns and total_words == 0:
        issues.append(
            ParseIssue(
                severity="warning",
                code="no_countable_words",
                message="No countable words were found, so word shares are not available.",
            )
        )

    if "\ufffd" in canonical:
        issues.append(
            ParseIssue(
                severity="warning",
                code="replacement_characters",
                message="The text contains “�” replacement characters, which usually means the file was not saved as UTF-8.",
            )
        )

    # ---- info ------------------------------------------------------------- #
    if continuation_lines:
        issues.append(
            ParseIssue(
                severity="info",
                code="continuation_lines",
                message=(
                    f"{len(continuation_lines)} {_plural(len(continuation_lines), 'line')} without a speaker label "
                    f"{_plural(len(continuation_lines), 'was', 'were')} added to the previous turn "
                    f"({_plural(len(continuation_lines), 'line')} {_format_lines(continuation_lines)})."
                ),
                lines=continuation_lines,
            )
        )

    ok = not any(issue.severity == "error" for issue in issues)
    return ParseResult(
        ok=ok,
        grammar_version=GRAMMAR_VERSION,
        transcript_hash=transcript_hash(canonical),
        char_count=len(canonical),
        line_count=len(lines),
        total_words=total_words,
        total_turns=len(turns),
        speakers=speakers,
        turns=turns,
        issues=issues,
    )
