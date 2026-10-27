"""A local stand-in for Anthropic's Messages API, for testing PRISM's live path without a key.

It speaks the same HTTP contract as `POST /v1/messages` closely enough for the
official Python SDK, so `scripts/live_smoke.py` can drive the *real* SDK, the
real HTTP round-trip and PRISM's provider adapter end to end. It checks the
request the way the real API would (headers, parameters, structured-output
schema limits) and answers with scripted outcomes. It is not a language model:
it says nothing about the quality of real model output.

Scenarios are chosen by a marker anywhere in the transcript text, e.g. a turn
"Tester: mock-scenario: repair". Without a marker the scenario is "ok".

    ok            valid output (bundled demo output when the transcript is a sample)
    repair        first answer is not JSON; the repair request gets valid output
    enum-case     valid output with capitalised enum values (the API allows this)
    flaky         HTTP 500 first, then valid output
    overloaded    HTTP 529 on every request
    rate-limit    HTTP 429 with retry-after: 7
    auth          HTTP 401
    not-found     HTTP 404 (unknown model)
    bad-request   HTTP 400 with a parameter message
    refusal       stop_reason "refusal"
    truncated     stop_reason "max_tokens" with cut-off JSON
    slow          answers after 8 seconds (longer than a short client timeout)

Usage: python scripts/mock_anthropic.py --port 8787 [--log requests.jsonl]
Only request metadata is logged, never transcript text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = sorted((ROOT / "samples" / "fixtures").glob("*.analysis.json"))
ALLOWED_KEYS = {
    "model", "max_tokens", "system", "messages", "output_config", "metadata", "stop_sequences", "temperature",
    "top_p", "top_k", "stream", "thinking", "tools", "tool_choice", "service_tier",
}
UNSUPPORTED_SCHEMA_KEYS = {"minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
MARKER = re.compile(r"mock-scenario:\s*([a-z-]+)")

_attempts: dict[str, int] = {}
_lock = threading.Lock()


def api_error(status: int, kind: str, message: str) -> tuple[int, dict, dict]:
    return status, {"type": "error", "error": {"type": kind, "message": message}}, {}


def check_schema(schema: dict) -> list[str]:
    """Apply the documented structured-output limits; return problems."""
    problems: list[str] = []
    unions = 0
    optional = 0

    def walk(node, path):
        nonlocal unions, optional
        if isinstance(node, dict):
            for key in UNSUPPORTED_SCHEMA_KEYS & node.keys():
                problems.append(f"{path}: unsupported keyword {key}")
            if node.get("minItems") not in (None, 0, 1):
                problems.append(f"{path}: minItems must be 0 or 1")
            if "anyOf" in node or isinstance(node.get("type"), list):
                unions += 1
            if node.get("type") == "object" or "properties" in node:
                if node.get("additionalProperties") is not False:
                    problems.append(f"{path}: additionalProperties must be false")
                props = node.get("properties", {})
                optional += len(set(props) - set(node.get("required", [])))
            for key, value in node.items():
                walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")

    walk(schema, "$")
    if unions > 16:
        problems.append(f"{unions} union-typed parameters (limit 16)")
    if optional > 24:
        problems.append(f"{optional} optional parameters (limit 24)")
    return problems


def turns_from(user_text: str) -> list[dict]:
    match = re.search(r"<meeting_turns>\n(.*)\n</meeting_turns>", user_text, re.S)
    return json.loads(match.group(1)) if match else []


def fixture_output(turns: list[dict]) -> dict | None:
    """Bundled demo output for a sample transcript, chosen by its quotations matching the turns."""
    by_id = {t["turn_id"]: t["text"] for t in turns}
    best, best_hits = None, 0
    for path in FIXTURES:
        output = json.loads(path.read_text(encoding="utf-8"))["model_output"]
        refs = [s for item in output["discussion_points"] for s in item["sources"]]
        hits = sum(1 for ref in refs if ref["quote"] in by_id.get(ref["turn_id"], ""))
        if refs and hits == len(refs) and hits > best_hits:
            best, best_hits = output, hits
    return best


def generic_output(turns: list[dict]) -> dict:
    """A small valid answer for any transcript: one discussion point quoting the longest turn."""
    speaking = [t for t in turns if t["text"].strip() and "mock-scenario" not in t["text"]] or turns
    if not speaking:
        return {"findings": [], "discussion_points": [], "decisions": [], "action_items": [], "suggestions": []}
    longest = max(speaking, key=lambda t: len(t["text"]))
    quote = " ".join(longest["text"].split()[:8])
    if quote not in longest["text"]:
        quote = longest["text"][:40]
    return {
        "findings": [],
        "discussion_points": [{"point": f"{longest['speaker']} raised the main topic.", "sources": [{"turn_id": longest["turn_id"], "quote": quote}]}],
        "decisions": [],
        "action_items": [],
        "suggestions": [{"suggestion": "Confirm owners and deadlines before the meeting ends.", "basis": "general", "finding_index": None, "sources": []}],
    }


def message(model: str, text: str, stop_reason: str = "end_turn") -> dict:
    return {
        "id": f"msg_mock_{uuid.uuid4().hex[:20]}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 1200, "output_tokens": 640},
    }


def respond(headers, body: dict) -> tuple[int, dict, dict]:
    # The SDK authenticates with `Authorization: Bearer <key>` (newer versions) or `x-api-key`.
    if not headers.get("x-api-key") and not headers.get("authorization", "").startswith("Bearer "):
        return api_error(401, "authentication_error", "invalid x-api-key")
    if not headers.get("anthropic-version"):
        return api_error(400, "invalid_request_error", "anthropic-version: header is required")
    unknown = set(body) - ALLOWED_KEYS
    if unknown:
        return api_error(400, "invalid_request_error", f"{sorted(unknown)[0]}: Extra inputs are not permitted")
    for key in ("model", "max_tokens", "messages"):
        if key not in body:
            return api_error(400, "invalid_request_error", f"{key}: Field required")
    fmt = (body.get("output_config") or {}).get("format") or {}
    if fmt.get("type") != "json_schema" or not isinstance(fmt.get("schema"), dict):
        return api_error(400, "invalid_request_error", "output_config.format: expected a json_schema format")
    effort = body["output_config"].get("effort")
    if effort is not None and effort not in EFFORTS:
        return api_error(400, "invalid_request_error", f"output_config.effort: unsupported value {effort!r}")
    problems = check_schema(fmt["schema"])
    if problems:
        return api_error(400, "invalid_request_error", "Schema is not supported: " + "; ".join(problems[:3]))

    user = body["messages"][-1]["content"]
    user_text = user if isinstance(user, str) else " ".join(b.get("text", "") for b in user if isinstance(b, dict))
    found = MARKER.search(user_text)
    scenario = found.group(1) if found else "ok"
    turns = turns_from(user_text)
    key = hashlib.sha256(json.dumps(turns, sort_keys=True).encode()).hexdigest()
    with _lock:
        _attempts[key] = _attempts.get(key, 0) + 1
        attempt = _attempts[key]
    is_repair = "did not match the required JSON schema" in user_text
    output = fixture_output(turns) or generic_output(turns)
    model = body["model"]

    if scenario == "repair" and not is_repair:
        return 200, message(model, '{"findings": [ {"turn_id": "T1", '), {}
    if scenario == "enum-case":
        output = json.loads(json.dumps(output))
        for f in output["findings"]:
            f["category"] = f["category"].title()
            if f["identity_characteristic"]:
                f["identity_characteristic"] = f["identity_characteristic"].upper()
        for d in output["decisions"]:
            d["status"] = d["status"].capitalize()
    if scenario == "flaky" and attempt == 1:
        return api_error(500, "api_error", "Internal server error")
    if scenario == "overloaded":
        return api_error(529, "overloaded_error", "Overloaded")
    if scenario == "rate-limit":
        status, payload, _ = api_error(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit")
        return status, payload, {"retry-after": "7"}
    if scenario == "auth":
        return api_error(401, "authentication_error", "invalid x-api-key")
    if scenario == "not-found":
        return api_error(404, "not_found_error", f"model: {model}")
    if scenario == "bad-request":
        return api_error(400, "invalid_request_error", "output_config.effort: this model does not support the effort parameter")
    if scenario == "refusal":
        return 200, message(model, "I can't help with that.", "refusal"), {}
    if scenario == "truncated":
        return 200, message(model, json.dumps(output)[:120], "max_tokens"), {}
    if scenario == "slow":
        time.sleep(8)
    return 200, message(model, json.dumps(output, ensure_ascii=False)), {}


class Handler(BaseHTTPRequestHandler):
    log_path: Path | None = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep stdout quiet
        pass

    def _send(self, status: int, payload: dict, extra: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.send_header("request-id", f"req_mock_{uuid.uuid4().hex[:16]}")
        for key, value in extra.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client already gave up (the "slow" scenario)

    def do_GET(self):
        self._send(200, {"ok": True}, {}) if self.path == "/health" else self._send(404, {"error": "not found"}, {})

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length)
        if self.path.split("?")[0] != "/v1/messages":
            return self._send(404, {"type": "error", "error": {"type": "not_found_error", "message": "Not found"}}, {})
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return self._send(*api_error(400, "invalid_request_error", "Request body is not valid JSON"))
        headers = {k.lower(): v for k, v in self.headers.items()}
        status, payload, extra = respond(headers, body)
        if self.log_path:
            user = body.get("messages", [{}])[-1].get("content", "")
            found = MARKER.search(user if isinstance(user, str) else "")
            record = {
                "status": status,
                "scenario": found.group(1) if found else "ok",
                "model": body.get("model"),
                "max_tokens": body.get("max_tokens"),
                "keys": sorted(body),
                "effort": (body.get("output_config") or {}).get("effort"),
                "format_type": ((body.get("output_config") or {}).get("format") or {}).get("type"),
                "system_chars": len(body.get("system") or ""),
                "repair": "did not match the required JSON schema" in (user if isinstance(user, str) else ""),
                "anthropic_version": headers.get("anthropic-version"),
                "stop_reason": payload.get("stop_reason"),
            }
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        self._send(status, payload, extra)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()
    Handler.log_path = args.log
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
