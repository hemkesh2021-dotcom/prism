"""Live-path contract check: real Anthropic SDK + real HTTP + PRISM, against a local mock API.

Starts `scripts/mock_anthropic.py` and the PRISM backend with ANTHROPIC_BASE_URL
pointing at the mock, then checks every live outcome through `POST /api/analyze`:
success, schema repair, capitalised enum values, transient 500, overload, rate
limit, bad key, unknown model, rejected parameter, refusal, truncation and timeout.
It also checks the exact request PRISM sent (parameters, structured-output schema
limits, no sampling parameters, at most two requests per analysis).

With --ui it also drives the browser through one live analysis (needs Playwright
and `npm run build`). This verifies PRISM's integration, not the quality of a real
model's answers; for that, run the app with a real key.

Run from the repository root:  python scripts/live_smoke.py [--ui]
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
PYTHON = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
MODEL = "claude-mock-1"
SAMPLE = (ROOT / "samples" / "age-dismissal.txt").read_text(encoding="utf-8")
SMALL = "Priya: Let's review the rollout plan for Friday.\nTomás: I'll update the runbook by Thursday.\n"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url: str, seconds: float = 20) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"{url} did not start")


@contextmanager
def servers(timeout_seconds: int = 5):
    log = Path(tempfile.mkdtemp(prefix="prism-mock-")) / "requests.jsonl"
    mock_port, app_port = free_port(), free_port()
    python = str(PYTHON if PYTHON.exists() else sys.executable)
    mock = subprocess.Popen([python, str(ROOT / "scripts" / "mock_anthropic.py"), "--port", str(mock_port), "--log", str(log)])
    env = {
        **os.environ,
        "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{mock_port}",
        "ANTHROPIC_API_KEY": "mock-key-not-secret",
        "ANTHROPIC_MODEL": MODEL,
        "ANTHROPIC_EFFORT": "medium",
        "PRISM_MODEL_TIMEOUT_SECONDS": str(timeout_seconds),
        "PRISM_SERVE_FRONTEND": "true",
    }
    app = subprocess.Popen(
        [python, "-m", "uvicorn", "prism.main:app", "--port", str(app_port)],
        cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_for(f"http://127.0.0.1:{mock_port}/health")
        wait_for(f"http://127.0.0.1:{app_port}/api/health")
        yield f"http://127.0.0.1:{app_port}", log
    finally:
        for proc in (app, mock):
            proc.terminate()
            proc.wait(timeout=10)


def analyze(base: str, transcript: str, n: int) -> tuple[int, dict, dict]:
    body = json.dumps({"transcript": transcript, "mode": "live", "analysis_id": f"smoke-{n:04d}-live"}).encode()
    request = urllib.request.Request(f"{base}/api/analyze", data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read()), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read()), dict(error.headers)


def requests_since(log: Path, start: int) -> list[dict]:
    lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return [json.loads(line) for line in lines[start:]]


def main() -> None:
    passed: list[str] = []

    def check(name: str, condition: bool, detail: object = "") -> None:
        if not condition:
            raise AssertionError(f"{name}: {detail}")
        passed.append(name)
        print(f"  PASS  {name}")

    with servers() as (base, log):
        health = json.loads(urllib.request.urlopen(f"{base}/api/health").read())
        check("health reports live analysis configured, without the key", health["live"]["available"] and "mock-key" not in json.dumps(health))

        cases = [
            # name, transcript, expected status, expected code (None = success), expected model requests
            ("ok: sample transcript", SAMPLE, 200, None, 1),
            ("ok: any transcript", SMALL, 200, None, 1),
            ("repair: invalid JSON, then one repair request", SMALL + "Tester: mock-scenario: repair\n", 200, None, 2),
            ("enum-case: capitalised enum values accepted", SAMPLE + "Tester: mock-scenario: enum-case\n", 200, None, 1),
            ("flaky: HTTP 500 retried once", SMALL + "Tester: mock-scenario: flaky\n", 200, None, 2),
            ("overloaded: HTTP 529 twice -> provider_unavailable", SMALL + "Tester: mock-scenario: overloaded\n", 503, "provider_unavailable", 2),
            ("rate limit: HTTP 429 not retried", SMALL + "Tester: mock-scenario: rate-limit\n", 429, "rate_limited", 1),
            ("auth: HTTP 401 -> provider_auth", SMALL + "Tester: mock-scenario: auth\n", 502, "provider_auth", 1),
            ("not found: HTTP 404 -> model_not_found", SMALL + "Tester: mock-scenario: not-found\n", 502, "model_not_found", 1),
            ("bad request: HTTP 400 -> provider_rejected_request", SMALL + "Tester: mock-scenario: bad-request\n", 502, "provider_rejected_request", 1),
            ("refusal: not retried, no results", SMALL + "Tester: mock-scenario: refusal\n", 502, "model_refusal", 1),
            ("truncated: discarded, not retried", SMALL + "Tester: mock-scenario: truncated\n", 502, "output_truncated", 1),
            ("slow: client timeout, not retried", SMALL + "Tester: mock-scenario: slow\n", 504, "timeout", 1),
        ]
        for n, (name, transcript, status, code, requests) in enumerate(cases, 1):
            start = len(requests_since(log, 0))
            got_status, data, headers = analyze(base, transcript, n)
            deadline = time.time() + 10  # the mock logs a request when it answers (the slow case answers late)
            while len(requests_since(log, start)) < requests and time.time() < deadline:
                time.sleep(0.2)
            made = requests_since(log, start)
            ok = got_status == status and (data.get("error", {}).get("code") if code else data.get("mode")) == (code or "live")
            check(f"{name} (HTTP {got_status}, {len(made)} model request(s))", ok and len(made) == requests, data if not ok else len(made))
            if name.startswith("ok: sample"):
                findings = data["analysis"]["findings"]
                check("live result: model id shown, 2 verified findings, paraphrase rejected", data["model"] == MODEL and len(findings) == 2
                      and [n_["code"] for n_ in data["notices"]] == ["quote_not_found"] and data["attempts"] == 1, data["notices"])
                check("live result: highlight offsets point at the quote", findings[0]["evidence"]["quote"] == "you are too young to understand this architecture")
            if name.startswith("enum-case"):
                check("enum-case: categories normalised to lower case", {f["category"] for f in data["analysis"]["findings"]} <= {"identity_dismissal", "personal_attack", "identity_stereotyping"})
            if name.startswith("rate limit"):
                check("rate limit: retry-after forwarded to the browser", headers.get("retry-after") == "7" and data["error"]["retry_after_seconds"] == 7)
            if name.startswith("bad request"):
                check("bad request: provider message kept, sanitized and short", "effort" in data["error"]["message"] and len(data["error"]["message"]) < 400)

        sent = requests_since(log, 0)
        check("every request: model, max_tokens, system, messages, output_config only", all(r["keys"] == ["max_tokens", "messages", "model", "output_config", "system"] for r in sent), {tuple(r["keys"]) for r in sent})
        check("every request: json_schema output, effort=medium, max_tokens=16000", all(r["format_type"] == "json_schema" and r["effort"] == "medium" and r["max_tokens"] == 16000 for r in sent))
        check("every request: anthropic-version header and the frozen system prompt", all(r["anthropic_version"] and r["system_chars"] > 1000 for r in sent))
        check("schema accepted by the documented structured-output limits", all(r["status"] != 400 or r["scenario"] == "bad-request" for r in sent))

        if "--ui" in sys.argv:
            run_ui(base, check)

    print(f"\n{len(passed)} live-path checks passed against the local mock API.")


def run_ui(base: str, check) -> None:
    from playwright.sync_api import expect, sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page.goto(base)
        page.get_by_role("button", name="Load sample").click()
        page.get_by_role("menuitem", name="Potential age-based dismissal").click()
        expect(page.get_by_text("Participation by word share")).to_be_visible(timeout=30_000)
        page.get_by_role("radio", name="Live analysis").click()
        page.get_by_role("button", name="Analyze meeting").click()
        expect(page.get_by_role("heading", name="Potential age-based dismissal", level=1)).to_be_visible(timeout=30_000)
        expect(page.get_by_text(MODEL)).to_be_visible()
        check("UI: live analysis completes, badge shows the configured model", True)
        page.get_by_role("tab", name="Language review").click()
        page.get_by_role("button", name="Potential age-based dismissal").first.click()
        expect(page.locator('[data-turn-id="T3"] mark')).to_have_text("you are too young to understand this architecture")
        check("UI: live finding highlights the verified quotation in T3", True)
        page.get_by_role("button", name="Download report").click()
        with page.expect_download() as info:
            page.get_by_role("button", name="Download Markdown").click()
        report = Path(info.value.path()).read_text(encoding="utf-8")
        check("UI: report records live mode and model id, no key", "Live analysis" in report and MODEL in report and "mock-key" not in report)

        # Error path in the UI: rate limiting shows a retry action and keeps the transcript.
        page.get_by_role("button", name="New analysis").click()
        editor = page.get_by_label("Transcript text")
        editor.fill(SMALL + "Tester: mock-scenario: rate-limit\n")
        page.get_by_role("button", name="Analyze meeting").click()
        expect(page.get_by_text("The AI provider is rate-limiting requests", exact=True)).to_be_visible(timeout=30_000)
        expect(page.get_by_text("Wait about 7 seconds and try again.", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Try again")).to_be_visible()
        check("UI: rate-limit error explains the wait, offers Try again, keeps the transcript", editor.input_value().startswith("Priya:"))
        browser.close()


if __name__ == "__main__":
    main()
