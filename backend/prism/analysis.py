"""Live analysis orchestration with a bounded retry.

At most `MAX_MODEL_REQUESTS` (2) requests are made per analysis:

* one additional request after a retryable transport failure
  (connection error, provider 5xx / overloaded), or
* one additional request after output that does not match the schema,
  with a short repair note listing only the failing field locations.

Timeouts, rate limits, refusals and truncated output are not retried. The SDK's
own retries are disabled in `provider.py`, so this is the complete retry budget.
Evidence validation never triggers a retry.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from anthropic import transform_schema
from pydantic import ValidationError

from .errors import ProviderError
from .prompts import build_user_message, load_prompt
from .provider import AnalysisProvider
from .schemas import LLMAnalysis, ParseResult

logger = logging.getLogger("prism.analysis")

MAX_MODEL_REQUESTS = 2
RETRY_BACKOFF_SECONDS = 1.0


@lru_cache(maxsize=1)
def model_output_schema() -> dict[str, Any]:
    """JSON schema sent to the provider, derived from the Pydantic model."""
    return transform_schema(LLMAnalysis)


@dataclass(frozen=True)
class LiveOutput:
    output: LLMAnalysis
    attempts: int


REPAIR_TEMPLATE = (
    "Your previous response could not be used because it did not match the required JSON schema "
    "(problems at: {where}). Return one complete JSON object that matches the schema exactly."
)


def _repair_note(error: ValidationError | json.JSONDecodeError) -> str:
    if isinstance(error, ValidationError):
        locations = sorted({".".join(str(part) for part in item["loc"]) or "(root)" for item in error.errors()})[:8]
        where = ", ".join(locations)
    else:
        where = "the response was not valid JSON"
    return REPAIR_TEMPLATE.format(where=where)


def instruction_fingerprint() -> str:
    """SHA-256 over everything the model is instructed with.

    Covers the system prompt, the output schema (including every field description),
    the user-message wrapper and the repair note. The evaluation freeze record stores
    this value, so editing any of them is detected before a held-out run.
    """
    bundle = {
        "prompt_version": load_prompt().version,
        "system": load_prompt().text,
        "schema": model_output_schema(),
        "wrapper": build_user_message([]),
        "repair": REPAIR_TEMPLATE,
    }
    encoded = json.dumps(bundle, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_output(text: str) -> LLMAnalysis:
    if not text.strip():
        raise json.JSONDecodeError("empty response", text, 0)
    return LLMAnalysis.model_validate_json(text)


def run_live_analysis(
    parsed: ParseResult,
    provider: AnalysisProvider,
    *,
    timeout_seconds: float,
    sleep=time.sleep,
    clock=time.monotonic,
) -> LiveOutput:
    prompt = load_prompt()
    schema = model_output_schema()
    repair_note: str | None = None
    started = clock()

    for attempt in range(1, MAX_MODEL_REQUESTS + 1):
        is_last = attempt == MAX_MODEL_REQUESTS
        try:
            response = provider.complete_json(
                system=prompt.text,
                user=build_user_message(parsed.turns, repair_note),
                schema=schema,
            )
        except ProviderError as exc:
            # Skip the retry if the first request already used a full timeout window.
            if exc.retryable and not is_last and clock() - started < timeout_seconds:
                logger.info("provider error code=%s attempt=%d; retrying once", exc.code, attempt)
                sleep(RETRY_BACKOFF_SECONDS)
                continue
            raise

        logger.info(
            "model response attempt=%d stop_reason=%s input_tokens=%s output_tokens=%s",
            attempt,
            response.stop_reason,
            response.input_tokens,
            response.output_tokens,
        )
        if response.stop_reason == "refusal":
            raise ProviderError(
                "model_refusal",
                "The model declined to analyze this transcript, so no results are shown. Review the transcript manually.",
                status=502,
            )
        if response.stop_reason == "max_tokens":
            raise ProviderError(
                "output_truncated",
                "The model's response was cut off before it was complete, so it was discarded. "
                "Try a shorter transcript or raise PRISM_MAX_OUTPUT_TOKENS.",
                status=502,
            )
        try:
            return LiveOutput(output=_parse_output(response.text), attempts=attempt)
        except (ValidationError, json.JSONDecodeError) as exc:
            # Log locations only: validation messages can contain model text.
            logger.warning("model output did not match schema attempt=%d", attempt)
            if is_last or clock() - started >= timeout_seconds:
                tried = "even after one repair attempt" if repair_note else "and the retry budget was already used"
                raise ProviderError(
                    "malformed_output",
                    f"The model's response did not match the expected format, {tried}. "
                    "No results are shown, to avoid a misleading or incomplete analysis. Try again.",
                    status=502,
                ) from None
            repair_note = _repair_note(exc)

    raise AssertionError("unreachable")  # pragma: no cover
