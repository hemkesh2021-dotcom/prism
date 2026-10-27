"""Language-model provider adapter.

The rest of the backend talks to `AnalysisProvider`, so the Anthropic SDK is
used in exactly one place. The SDK's own retries are disabled (`max_retries=0`);
`analysis.py` owns the single, bounded retry so the total number of model
requests is easy to state: at most two per analysis.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic

from .errors import ProviderError

logger = logging.getLogger("prism.provider")


@dataclass(frozen=True)
class ProviderResponse:
    text: str
    stop_reason: str | None
    request_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class AnalysisProvider(Protocol):
    model: str

    def complete_json(self, *, system: str, user: str, schema: dict[str, Any]) -> ProviderResponse: ...


def _retry_after(error: anthropic.APIStatusError) -> int | None:
    try:
        value = error.response.headers.get("retry-after")
        return max(1, int(float(value))) if value else None
    except (AttributeError, TypeError, ValueError):
        return None


def _api_message(error: anthropic.APIStatusError) -> str:
    """Short, sanitized provider message (parameter problems such as an unsupported model or option)."""
    body = getattr(error, "body", None)
    message = None
    if isinstance(body, dict):
        inner = body.get("error")
        if isinstance(inner, dict):
            message = inner.get("message")
    text = str(message or "").strip()
    return text[:240]


class AnthropicProvider:
    def __init__(self, *, api_key: str, model: str, effort: str | None, timeout_seconds: float, max_output_tokens: int) -> None:
        self.model = model
        self._effort = effort
        self._max_output_tokens = max_output_tokens
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=0, timeout=timeout_seconds)

    def complete_json(self, *, system: str, user: str, schema: dict[str, Any]) -> ProviderResponse:
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if self._effort:
            output_config["effort"] = self._effort
        try:
            message = self._client.messages.create(
                model=self.model,
                max_tokens=self._max_output_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config=output_config,
            )
        except anthropic.APITimeoutError as exc:
            raise ProviderError(
                "timeout",
                "The model did not respond within the configured time limit. Try again, or analyze a shorter transcript.",
                status=504,
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(
                "provider_unreachable",
                "The backend could not reach the AI provider. Check the server's internet connection and try again.",
                status=502,
                retryable=True,
            ) from exc
        except anthropic.RateLimitError as exc:
            retry_after = _retry_after(exc)
            wait = f" Wait about {retry_after} seconds and try again." if retry_after else " Wait a moment and try again."
            raise ProviderError("rate_limited", "The AI provider is rate-limiting requests." + wait, status=429, retry_after=retry_after) from exc
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            raise ProviderError(
                "provider_auth",
                "The AI provider rejected the server's API key. Check ANTHROPIC_API_KEY in backend/.env and restart the backend.",
                status=502,
            ) from exc
        except anthropic.NotFoundError as exc:
            raise ProviderError(
                "model_not_found",
                f"The provider did not recognize the model “{self.model}”. Check ANTHROPIC_MODEL in backend/.env.",
                status=502,
            ) from exc
        except anthropic.RequestTooLargeError as exc:
            raise ProviderError("provider_request_too_large", "The provider rejected the request as too large.", status=502) from exc
        except anthropic.DeadlineExceededError as exc:
            raise ProviderError("timeout", "The AI provider timed out while processing the request. Try again.", status=504) from exc
        except anthropic.BadRequestError as exc:
            detail = _api_message(exc)
            raise ProviderError(
                "provider_rejected_request",
                "The AI provider rejected the request" + (f": {detail}" if detail else ".")
                + " Check that ANTHROPIC_MODEL supports structured outputs and that ANTHROPIC_EFFORT is supported by that model.",
                status=502,
            ) from exc
        except (anthropic.InternalServerError, anthropic.OverloadedError, anthropic.ServiceUnavailableError) as exc:
            raise ProviderError(
                "provider_unavailable",
                "The AI provider is temporarily unavailable or overloaded. Try again shortly.",
                status=503,
                retryable=True,
            ) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError("provider_error", f"The AI provider returned an unexpected error (HTTP {exc.status_code}).", status=502) from exc

        text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
        usage = getattr(message, "usage", None)
        return ProviderResponse(
            text=text,
            stop_reason=message.stop_reason,
            request_id=getattr(message, "_request_id", None),
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )
