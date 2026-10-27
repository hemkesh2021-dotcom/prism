"""Application errors with stable codes.

Every error the API returns has the shape
`{"error": {"code": ..., "message": ..., "retry_after_seconds": ...}}`.
Messages are written for the person using the app and never contain transcript
text, model output, or credentials.
"""

from __future__ import annotations


class PrismError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, retry_after: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


class ProviderError(PrismError):
    """A failure while calling the language-model provider."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 502,
        retryable: bool = False,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(code, message, status=status, retry_after=retry_after)
        self.retryable = retryable
