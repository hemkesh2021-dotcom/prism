from __future__ import annotations

import json
import logging
import shutil

from prism.config import SAMPLES_DIR, Settings
from prism.main import create_app
from prism.samples import SampleCatalog

from .conftest import FakeProvider, empty_output, provider_error

SECRET_PHRASE = "zebra-umbrella-quasar"


def sample_text(catalog, sample_id):
    return next(s.transcript for s in catalog.list() if s.sample_id == sample_id)


def analyze(client, transcript, mode="live", sample_id=None, analysis_id="analysis-0001"):
    body = {"transcript": transcript, "mode": mode, "analysis_id": analysis_id}
    if sample_id:
        body["sample_id"] = sample_id
    return client.post("/api/analyze", json=body)


def test_health_reports_missing_configuration(make_client):
    data = make_client().get("/api/health").json()
    assert data["live"] == {"available": False, "model": None, "effort": None, "missing": ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]}
    assert data["limits"] == {"max_transcript_chars": 40000, "max_upload_bytes": 262144}
    assert data["prompt_version"] == "analysis-v1.0"


def test_health_never_exposes_the_key(make_client):
    response = make_client(FakeProvider([])).get("/api/health")
    assert response.json()["live"]["available"] is True
    assert "test-key" not in response.text


def test_samples_endpoint(make_client):
    samples = make_client().get("/api/samples").json()
    assert [s["sample_id"] for s in samples] == ["neutral-planning", "technical-disagreement", "age-dismissal"]
    assert all(s["demo_available"] for s in samples)


def test_parse_endpoint_and_input_errors(make_client):
    client = make_client()
    ok = client.post("/api/parse", json={"transcript": "Arun: Hello there.\nMeera: Hi."})
    assert ok.status_code == 200 and ok.json()["total_words"] == 3

    empty = client.post("/api/parse", json={"transcript": "  "})
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "transcript_empty"

    small = make_client(max_transcript_chars=100)
    too_long = small.post("/api/parse", json={"transcript": "A: " + "word " * 50})
    assert too_long.status_code == 413 and too_long.json()["error"]["code"] == "transcript_too_long"


def test_invalid_request_does_not_echo_content(make_client):
    response = make_client().post("/api/analyze", json={"transcript": SECRET_PHRASE, "analysis_id": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert SECRET_PHRASE not in response.text


def test_oversized_body_is_rejected(make_client):
    client = make_client(max_transcript_chars=100, max_upload_bytes=1024)
    response = client.post("/api/parse", content=json.dumps({"transcript": "A: " + "x" * 20000}), headers={"content-type": "application/json"})
    assert response.status_code == 413 and response.json()["error"]["code"] == "request_too_large"


def test_oversized_chunked_body_without_length_is_rejected(make_client):
    client = make_client(max_transcript_chars=100, max_upload_bytes=1024)

    def chunks():
        yield b'{"transcript": "A: '
        for _ in range(40):
            yield b"x" * 1024
        yield b'"}'

    response = client.post("/api/parse", content=chunks(), headers={"content-type": "application/json"})
    assert response.status_code == 413 and response.json()["error"]["code"] == "request_too_large"


def test_demo_runs_fixture_through_validation(make_client, catalog):
    response = analyze(make_client(), sample_text(catalog, "age-dismissal"), mode="demo", sample_id="age-dismissal")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "demo" and data["model"] is None and data["attempts"] == 0
    assert data["analysis_id"] == "analysis-0001"
    assert data["findings_returned"] == 3
    assert [f["finding_id"] for f in data["analysis"]["findings"]] == ["F1", "F2"]
    assert data["analysis"]["findings"][0]["evidence"]["speaker_label"] == "Arun"
    assert [n["code"] for n in data["notices"]] == ["quote_not_found"]
    assert data["parse"]["total_turns"] == 17


def test_demo_accepts_crlf_copy_of_sample(make_client, catalog):
    text = sample_text(catalog, "neutral-planning").replace("\n", "\r\n")
    assert analyze(make_client(), text, mode="demo", sample_id="neutral-planning").status_code == 200


def test_demo_rejects_edited_or_arbitrary_transcripts(make_client, catalog):
    client = make_client()
    edited = sample_text(catalog, "age-dismissal") + "Arun: One more thing.\n"
    response = analyze(client, edited, mode="demo", sample_id="age-dismissal")
    assert response.status_code == 409 and response.json()["error"]["code"] == "demo_requires_unedited_sample"

    other = analyze(client, "Arun: A different meeting.", mode="demo", sample_id="age-dismissal")
    assert other.status_code == 409

    missing = analyze(client, "Arun: A different meeting.", mode="demo")
    assert missing.status_code == 409 and missing.json()["error"]["code"] == "demo_unavailable"


def test_live_without_configuration_never_falls_back_to_demo(make_client, catalog):
    response = analyze(make_client(), sample_text(catalog, "age-dismissal"))
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "live_not_configured"
    assert "analysis" not in body


def test_live_uses_provider_output_not_fixture_even_for_sample_text(make_client, catalog):
    provider = FakeProvider([empty_output()])
    response = analyze(make_client(provider), sample_text(catalog, "age-dismissal"))
    data = response.json()
    assert response.status_code == 200
    assert data["mode"] == "live" and data["model"] == "fake-model" and data["sample_id"] is None
    assert data["analysis"]["findings"] == [] and data["notices"] == []
    assert data["attempts"] == 1


def test_live_provider_failure_is_reported_without_results(make_client):
    provider = FakeProvider([provider_error("rate_limited", status=429, retry_after=12)])
    response = analyze(make_client(provider), "Arun: Hello.\nMeera: Hi.")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "12"
    assert response.json() == {"error": {"code": "rate_limited", "message": "rate_limited message", "retry_after_seconds": 12}}


def test_parse_errors_block_analysis_before_any_model_call(make_client):
    provider = FakeProvider([])
    response = analyze(make_client(provider), "Notes from Monday\nArun: Hello.")
    assert response.status_code == 422 and response.json()["error"]["code"] == "parse_failed"
    assert provider.calls == []


def test_server_reparses_instead_of_trusting_client_metrics(make_client):
    provider = FakeProvider([empty_output()])
    response = analyze(make_client(provider), "Arun: one two three\nMeera: four")
    speakers = response.json()["parse"]["speakers"]
    assert [(s["label"], s["words"]) for s in speakers] == [("Arun", 3), ("Meera", 1)]


def test_transcripts_and_model_output_are_not_logged(make_client, caplog):
    output = empty_output(discussion_points=[{"point": SECRET_PHRASE + " point", "sources": [{"turn_id": "T1", "quote": SECRET_PHRASE}]}])
    provider = FakeProvider([output])
    with caplog.at_level(logging.DEBUG):
        response = analyze(make_client(provider), f"Arun: the {SECRET_PHRASE} plan.")
    assert response.status_code == 200
    assert SECRET_PHRASE not in caplog.text
    assert "analyze mode=live" in caplog.text


def test_fixture_bound_to_sample_hash(tmp_path):
    shutil.copytree(SAMPLES_DIR, tmp_path / "samples")
    sample_file = tmp_path / "samples" / "age-dismissal.txt"
    sample_file.write_text(sample_file.read_text(encoding="utf-8") + "Sofia: Thanks all.\n", encoding="utf-8")
    catalog = SampleCatalog.load(tmp_path / "samples")
    from fastapi.testclient import TestClient

    client = TestClient(create_app(settings=Settings(serve_frontend=False), catalog=catalog))
    text = next(s.transcript for s in catalog.list() if s.sample_id == "age-dismissal")
    response = analyze(client, text, mode="demo", sample_id="age-dismissal")
    assert response.status_code == 500 and response.json()["error"]["code"] == "demo_fixture_mismatch"
