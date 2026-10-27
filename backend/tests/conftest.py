from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from prism.config import SAMPLES_DIR, Settings
from prism.errors import ProviderError
from prism.main import create_app
from prism.parsing import parse_transcript
from prism.provider import ProviderResponse
from prism.samples import SampleCatalog


@dataclass
class FakeProvider:
    """Scripted provider: each call pops the next item (a ProviderResponse, dict, str or exception)."""

    script: list[Any]
    model: str = "fake-model"
    calls: list[dict[str, Any]] = field(default_factory=list)

    def complete_json(self, *, system: str, user: str, schema: dict[str, Any]) -> ProviderResponse:
        self.calls.append({"system": system, "user": user, "schema": schema})
        if not self.script:
            raise AssertionError("FakeProvider called more times than scripted")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, ProviderResponse):
            return item
        text = item if isinstance(item, str) else json.dumps(item)
        return ProviderResponse(text=text, stop_reason="end_turn")


def empty_output(**overrides: Any) -> dict[str, Any]:
    output = {"findings": [], "discussion_points": [], "decisions": [], "action_items": [], "suggestions": []}
    output.update(overrides)
    return output


@pytest.fixture
def make_client() -> Callable[..., TestClient]:
    def _make(provider: FakeProvider | None = None, **settings_overrides: Any) -> TestClient:
        base = {"anthropic_api_key": None, "anthropic_model": None, "serve_frontend": False}
        if provider is not None:
            base.update(anthropic_api_key="test-key", anthropic_model=provider.model)
        base.update(settings_overrides)
        app = create_app(settings=Settings(**base), provider=provider, catalog=SampleCatalog.load(SAMPLES_DIR))
        return TestClient(app)

    return _make


@pytest.fixture
def catalog() -> SampleCatalog:
    return SampleCatalog.load(SAMPLES_DIR)


@pytest.fixture
def parsed_meeting():
    text = (
        "Arun: You are too young to understand this architecture.\n"
        "Meera: Could you explain which part of my proposal is incorrect?\n"
        "Arun: This approach may increase database latency under load.\n"
        "Meera: Agreed. Let us benchmark it before deciding. I'll write the benchmark by next Friday.\n"
    )
    return parse_transcript(text)


def provider_error(code: str, *, retryable: bool = False, status: int = 502, retry_after: int | None = None) -> ProviderError:
    return ProviderError(code, f"{code} message", status=status, retryable=retryable, retry_after=retry_after)
