"""Runtime configuration.

Values come from environment variables. `backend/.env` is loaded by `main.py`
before settings are read, so local development only needs that one file.
Secrets are never logged and never sent to the browser.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SAMPLES_DIR = REPO_ROOT / "samples"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


class ConfigError(ValueError):
    """Raised when an environment variable has an invalid value."""


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    anthropic_effort: str | None = None
    max_transcript_chars: int = 40_000
    max_upload_bytes: int = 256 * 1024
    model_timeout_seconds: float = 120.0
    max_output_tokens: int = 16_000
    frontend_origin: str = "http://localhost:5173"
    serve_frontend: bool = True

    @property
    def live_available(self) -> bool:
        return bool(self.anthropic_api_key and self.anthropic_model)

    @property
    def missing_live_settings(self) -> list[str]:
        missing = []
        if not self.anthropic_api_key:
            missing.append("ANTHROPIC_API_KEY")
        if not self.anthropic_model:
            missing.append("ANTHROPIC_MODEL")
        return missing

    @property
    def max_request_bytes(self) -> int:
        # JSON escaping can expand text; allow twice the largest legal payload.
        largest = max(self.max_upload_bytes, 4 * self.max_transcript_chars)
        return 2 * largest + 16 * 1024

    @property
    def client_timeout_seconds(self) -> int:
        # At most two model requests (see analysis.MAX_MODEL_REQUESTS) plus margin.
        return int(2 * self.model_timeout_seconds + 15)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _int(env: Mapping[str, str], name: str, default: int, minimum: int) -> int:
    raw = _clean(env.get(name))
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be at least {minimum}")
    return value


def _float(env: Mapping[str, str], name: str, default: float, minimum: float) -> float:
    raw = _clean(env.get(name))
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be at least {minimum}")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    effort = _clean(env.get("ANTHROPIC_EFFORT"))
    if effort is not None and effort not in EFFORT_LEVELS:
        raise ConfigError(f"ANTHROPIC_EFFORT must be one of {', '.join(EFFORT_LEVELS)}")
    serve_frontend = (_clean(env.get("PRISM_SERVE_FRONTEND")) or "true").lower() not in {"0", "false", "no"}
    return Settings(
        anthropic_api_key=_clean(env.get("ANTHROPIC_API_KEY")),
        anthropic_model=_clean(env.get("ANTHROPIC_MODEL")),
        anthropic_effort=effort,
        max_transcript_chars=_int(env, "PRISM_MAX_TRANSCRIPT_CHARS", 40_000, 100),
        max_upload_bytes=_int(env, "PRISM_MAX_UPLOAD_BYTES", 256 * 1024, 1024),
        model_timeout_seconds=_float(env, "PRISM_MODEL_TIMEOUT_SECONDS", 120.0, 5.0),
        max_output_tokens=_int(env, "PRISM_MAX_OUTPUT_TOKENS", 16_000, 1024),
        frontend_origin=_clean(env.get("PRISM_FRONTEND_ORIGIN")) or "http://localhost:5173",
        serve_frontend=serve_frontend,
    )
