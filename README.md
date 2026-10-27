# PRISM — Meeting Communication & Bias Analyzer

PRISM helps a person review a meeting transcript with visible evidence. Paste or upload an English transcript
written as `Speaker: Message`, check how it was parsed, and get:

1. deterministic participation statistics (words, turns and word share per speaker);
2. potential identity-related language concerns, kept separate from personal attacks and dismissive remarks;
3. exact quotations with speaker attribution and explanations;
4. discussion points, decisions and action items, each linked to supporting quotations;
5. suggestions and alternative wording;
6. reviewer feedback for each finding and a downloadable Markdown report.

PRISM never claims to prove that anyone is biased. It points to language that may be worth reviewing, shows the
exact words, and leaves the judgment to a person.

---

## Quick start

### Requirements

- **Python 3.11 or newer** (3.10 is the minimum supported by the Anthropic SDK; 3.11+ is recommended)
- **Node.js 22.12 or newer** (Node 22 LTS or 24 LTS)
- An Anthropic API key **only** for live analysis. The sample demo needs no key and no internet access once
  dependencies are installed.

### 1. Backend (FastAPI)

macOS / Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt      # runtime + test dependencies (pinned)
cp .env.example .env                     # optional: only needed for live analysis
uvicorn prism.main:app --reload --port 8000
```

Windows (PowerShell):

```powershell
cd backend
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
uvicorn prism.main:app --reload --port 8000
```

`requirements.txt` holds the runtime dependencies only, fully pinned for macOS, Windows and Linux.

### 2. Frontend (React + Vite)

In a second terminal:

```bash
cd frontend
npm ci              # installs the exact versions in package-lock.json
npm run dev         # http://localhost:5173  (proxies /api to http://127.0.0.1:8000)
```

Open <http://localhost:5173>, choose **Load sample → Potential age-based dismissal**, and press **Analyze
meeting**. The mode switch shows **Sample demo** for unedited samples.

### Single-port mode (for demos)

```bash
cd frontend && npm run build          # creates frontend/dist
cd ../backend && uvicorn prism.main:app --port 8000
```

The backend serves the built app at <http://localhost:8000> when `frontend/dist` exists.

### Enable live analysis

Edit `backend/.env`:

```ini
ANTHROPIC_API_KEY=your-key-here
ANTHROPIC_MODEL=claude-sonnet-5-5
ANTHROPIC_EFFORT=medium        # optional
```

Restart the backend. The key is read only by the Python server. It is never sent to the browser, never logged,
and never placed in a `VITE_*` variable.

Model IDs were checked against Anthropic's [models overview](https://platform.claude.com/docs/en/models/overview)
on 26 Oct 2026: `claude-sonnet-5-5` (balanced; used in `.env.example`), `claude-haiku-5-5` (lowest cost and
latency) and `claude-opus-5-5`. Any Claude model that supports
[structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) should work;
remove `ANTHROPIC_EFFORT` for models that do not support the effort parameter. Live analysis is paid usage on
your own account.

---

## Repository layout

```
backend/
  prism/
    main.py            FastAPI app: routes, error handling, request size limit, CORS
    config.py          settings from environment variables
    parsing.py         transcript grammar, canonical form, input limits
    metrics.py         word-count rule and participation statistics
    schemas.py         Pydantic models: API, model-output schema, validated results
    prompts/           versioned system prompt (analysis_v1.md) and turn serialization
    provider.py        Anthropic adapter (the only module that imports the SDK)
    analysis.py        live analysis with one bounded retry
    validation.py      exact-quote evidence validation, owner/deadline checks, dedup
    samples.py         bundled samples and hash-bound demo fixtures
    errors.py          error codes
  tests/               pytest suite (provider mocked; no network)
  requirements*.in / requirements*.txt, .env.example, pyproject.toml
frontend/
  src/
    App.tsx, main.tsx, index.css (design tokens)
    state/             in-memory workspace reducer and request handling
    lib/               API client, types, report builder, formatting, motion settings
    components/        input, results, layout and UI primitives (shadcn-style, Radix)
    scene/             Conversation Lens (React Three Fiber) and its SVG fallback
  package.json, package-lock.json, vite.config.ts, tsconfig*.json
samples/               three sample transcripts, catalog, demo fixtures
evaluation/            dev and held-out sets, rubric, annotation template, scorer, runner
scripts/e2e_smoke.py   browser end-to-end check of the whole workflow
scripts/live_smoke.py  live-path contract check against scripts/mock_anthropic.py (no key needed)
```

---

## How it works

```
Browser (React)                         Python backend (FastAPI, stateless)
───────────────                         ───────────────────────────────────
paste / upload / sample
        │  POST /api/parse  ─────────▶  canonicalize → validate limits → parse turns → count words
        │  ◀────────────── participation, turns, parsing notes
Analyze │  POST /api/analyze ────────▶  re-parse (never trusts client metrics)
        │                                 live: prompt + JSON-serialized turns → Claude (structured output)
        │                                 demo: hash-checked fixture for the unedited sample
        │                               → schema validation → evidence validation → result + notices
        │  ◀────────────── findings, summary, actions, suggestions, notices
review, annotate, export Markdown (all in browser memory)
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | status, limits, whether live analysis is configured, model ID, prompt version |
| `GET /api/samples` | the bundled samples and whether demo results exist for them |
| `POST /api/parse` | parsing and deterministic participation metrics |
| `POST /api/analyze` | validated analysis (`mode: "live"` or `"demo"`), bound to a client `analysis_id` |

Interactive API docs are at `/api/docs` while the backend runs.

### Transcript grammar (version 1)

1. **Canonical form.** One leading UTF-8 BOM is removed, and CRLF, CR and the Unicode line separators
   (U+2028, U+2029, NEL) become LF. Limits, hashing, parsing and evidence checks all use this text.
2. **A turn starts** on a line whose *first* colon is followed by a space, a tab or the end of the line, and
   whose text before that colon is a valid speaker label. Later colons stay in the message
   (`Arun: Agenda: item one` → speaker `Arun`, message `Agenda: item one`). URLs and times (`https://…`,
   `10:30`) do not start turns.
3. **Valid label:** 1–40 characters, at most five words, starting with a letter; letters, digits, spaces and
   `. ' ’ - _ ( )` only. A one-off label that reads like part of a sentence ("Bottom line: we ship Friday")
   still starts a turn, but the preview warns about it.
4. **Continuation lines** (non-blank lines without a label) belong to the previous turn. Blank lines are
   skipped. Text before the first speaker label is an **error** and blocks analysis.
5. **Labels are trimmed but never merged.** `Arun`, `arun` and `Arun K` are different speakers; PRISM warns
   when labels look similar instead of guessing.
6. Turns get stable IDs (`T1`, `T2`, …) and speakers get IDs in order of first appearance (`S1`, …).
7. Timestamped formats such as `[10:02] Arun: …` are outside this version.

The preview reports errors, warnings (missing space after a colon, similar labels, heading-like labels such as
`Agenda:`, empty turns, replacement characters) and notes (which lines were treated as continuations), so
nothing is silently discarded.

### Word counting

A word is a run of letters or digits. Runs joined by an internal hyphen, apostrophe, underscore or period stay
one word, and a comma between digits joins numbers:

| Text | Words |
| --- | ---: |
| `don't`, `Arun's`, `we’re` | 1 each |
| `well-known`, `state-of-the-art` | 1 each |
| `3.5`, `1,000`, `1,000.50`, `v2.0`, `e.g.`, `user_id` | 1 each |
| `50%`, `$20` | 1 each |
| `A/B` | 2 |
| `—`, `...`, `🎉` | 0 |

Word share = a speaker's words ÷ all words, computed from full counts and rounded only for display. With zero
words the share is "n/a", not a division error. **Word share is not speaking time**, and unequal word share is
never treated as a concern on its own. "Speakers" means labels present in the transcript; absent attendees are
not inferred.

### Limits

40,000 characters (Unicode code points of the canonical text) and 256 KiB per uploaded file, checked in the
browser and again on the server. Empty input, invalid UTF-8, binary-looking text and oversized input are
rejected with a message that says what to do. PRISM never truncates.

### Language analysis

The system prompt lives in `backend/prism/prompts/analysis_v1.md` (version `analysis-v1.0`). The model looks
for three narrow categories:

- **Identity-based stereotyping** — a generalization about people based on an identity characteristic.
- **Identity-based dismissal** — dismissing a contribution because of an explicitly mentioned characteristic.
- **Personal attack or dismissive communication** — attacking a person rather than their contribution
  (shown separately from the two identity categories).

It is told not to flag respectful disagreement, technical criticism, task assignment, low participation or
disagreement with seniors; to treat quoted, reported, rebutted, negated and hypothetical statements as not the
speaker's endorsed view; never to infer identity from names; never to diagnose intent; and to use cautious
language ("Potential age-based dismissal", "Worth reviewing in context") with no scores or percentages.

**Prompt injection.** Transcript text is untrusted data. Turns are sent as a JSON array inside
`<meeting_turns>` tags in the user message, separate from the system prompt, with `<` and `>` escaped so a
turn cannot close the wrapper. The request has no tools, and the output is constrained by a JSON schema
(structured outputs), so instructions inside a meeting cannot change the format.

**Structured output.** The schema is generated from the `LLM*` Pydantic models with `anthropic.transform_schema`
and sent as `output_config.format`. Deterministic metrics are not part of it: the model never counts. Enum values
that differ from the schema only in capitalisation (which Anthropic documents as possible) are accepted rather than
treated as malformed.

**Bounded retries.** The SDK's automatic retries are disabled (`max_retries=0`). PRISM makes at most **two**
model requests per analysis: one more after a connection or provider-side 5xx/overloaded error, or one more
after output that fails schema validation (with a repair note naming only the failing fields). Timeouts, rate
limits, refusals and truncated output are not retried. The worst case is about two request timeouts
(`PRISM_MODEL_TIMEOUT_SECONDS`, 120 s by default).

### Evidence validation

Every quotation, in findings and in summary sources alike, must:

1. cite a turn that exists (IDs compared case-insensitively);
2. be non-empty and contain a letter or digit;
3. occur **verbatim inside that exact turn**. A match in a different turn is rejected as possible
   misattribution. There is no fuzzy matching; the only equivalence is length-preserving and documented:
   curly quotes and apostrophes match straight ones, and any whitespace character matches any other single
   whitespace character;
4. take its speaker from the parsed turn, never from the model.

The displayed quotation is the transcript's own text for the matched span. Findings for the same turn and
category with overlapping spans are merged. Summary items keep only verified sources and are dropped when none
verify. Action-item **owners** must be the speaker of a cited turn or be named in one, and **deadlines** must
be stated in a cited turn. Matches are whole-word ("Ann" never matches inside "planning") and case-sensitive
for single words ("May" is not borrowed from the verb "may"); both are shown as the transcript spells them, and
anything unsupported is shown as "Not specified". Every omission produces a
validation notice, and a result whose findings all failed validation is explicitly shown as *not* an all-clear.

**"Quotation verified" means the words exist where cited, not that the model's interpretation is right.**

Highlights use UTF-16 code-unit offsets (the unit JavaScript strings use), computed in Python, and the
browser checks that the slice equals the quotation before highlighting. With repeated phrases the first
occurrence is highlighted and the count is shown.

### Live and demo modes

- **Live analysis** calls the configured model through the backend. If configuration is missing, the app shows
  how to enable it, and the API answers `503 live_not_configured`. A failed live request is never answered
  with demo data.
- **Sample demo** uses hand-written fixtures in `samples/fixtures/`, each bound to the SHA-256 of its unedited
  sample and run through the same schema and evidence validation. Editing the sample switches the demo off. The
  age-dismissal fixture includes one deliberately paraphrased quotation so the demo shows validation at work.

Distinct states are handled for: missing configuration, timeout, rate limiting, invalid key, unknown model,
rejected request, refusal, truncated output, malformed output, invalid evidence, backend unavailable, and a
valid result with no findings.

### Session binding

The transcript, results and review notes live only in React state. Every edit, upload, sample load or clear
increases a transcript version. A response is accepted only when its `analysis_id` **and** transcript version
both match the running request; stale or cancelled responses are ignored. Reviews belong to one analysis and
are discarded when the transcript changes or a new analysis starts. The Analyze button is disabled while a
request runs, so accidental duplicate paid requests are not sent.

---

## Privacy and security

- Nothing about a meeting is stored in `localStorage`, `sessionStorage`, IndexedDB, the URL, server memory,
  files or a database. The only browser storage is the motion setting.
- The backend does not log request bodies, transcripts, model output or keys; logs contain counts and timings.
  Validation errors are answered without echoing the request body.
- **Clear session** resets the app and invalidates pending responses. It cannot delete data the AI provider has
  already received for a live analysis, which the provider processes under its own terms.
- No analytics, no remote fonts (Manrope is bundled), CORS limited to the dev origin, request bodies capped.
- The report includes the full transcript only when you tick that option (off by default) and never includes
  credentials or server configuration.

---

## Interface notes

- Light, warm porcelain palette with graphite text and restrained teal for actions and focus. Depth carries
  meaning: raised panels are things you act on and primary results; inset wells hold source text and evidence.
- Speaker colours use a fixed order validated for colour-vision-deficiency separation (adjacent pairs; the
  first four distinguishable as any pair). Speakers after the sixth share a neutral and are always named. Text
  never relies on colour alone.
- Identity-related concerns use amber with a solid highlight; personal attacks use slate with a dashed
  underline; summary sources use mint.
- **Conversation Lens**: three glass ribbons (fresnel-lit edges, faded ends) with tapered brushed-graphite rims
  around a luminous core, a soft contact shadow and a staggered entrance, built procedurally with React Three Fiber
  (generated textures only: no image files, models or HDR downloads). It is decorative and encodes nothing. It is
  lazy-loaded; pausing eases the rotation to a stop and then renders on demand; it stops when offscreen or the tab
  is hidden; the pixel ratio is capped at 1.75; and during analysis the same scene shrinks by CSS scaling, so the
  WebGL canvas never resizes. It falls back to a designed SVG (each ring on its own compositor layer) for phones,
  reduced motion, missing WebGL, a lost context, software-only WebGL (`failIfMajorPerformanceCaveat` or a
  SwiftShader/llvmpipe renderer), or a frame rate that stays below about 22 fps.
- Motion: one entrance sequence, 150–250 ms control feedback, 220–320 ms panels and tab changes, a chart and
  metric counts that animate to their exact values, a highlight sweep on the selected quotation, and short
  confirmations (report saved, wording copied). **Motion → Reduced** (or the operating-system setting) removes
  rotation, parallax, animated scrolling, count-ups and spatial transitions.
- Keyboard: skip link, Radix tabs/menus/dialogs with focus management, visible focus rings, 44 px targets, a
  range control and a list alternative for the turn sequence.

---

## Tests and checks

```bash
# backend unit and API tests (provider mocked)
cd backend && python -m pytest

# frontend unit tests, type check, production build
cd frontend && npm test && npm run typecheck && npm run build

# optional browser end-to-end check (after the build)
pip install playwright && python -m playwright install chromium
python scripts/e2e_smoke.py

# live-path contract check without a key: real Anthropic SDK + HTTP against a local mock API
python scripts/live_smoke.py          # add --ui to drive one live analysis in the browser
```

`scripts/mock_anthropic.py` imitates `POST /v1/messages` closely enough for the official SDK: it checks the request
(headers, parameters, the documented structured-output schema limits) and answers with scripted outcomes: valid
output, a schema repair, capitalised enum values, HTTP 500/529/429/401/404/400, a refusal, truncation and a slow
response. `live_smoke.py` asserts how PRISM handles each one (status, error code, number of model requests, retry
budget, `retry-after`). It verifies the integration, not the quality of a real model's answers.

The backend suite covers parsing (continuations, later colons, BOM/CRLF, labels, warnings, empty input, limits),
word counting and word share, evidence validation (wrong-turn and nonexistent quotations, paraphrases,
curly-quote and whitespace equivalence, Unicode offsets with emoji, repeated substrings, duplicates, owners and
deadlines), the retry budget, refusal/truncation/malformed output, prompt-injection serialization, demo/live
separation and fixture hash binding, sanitized errors and the absence of transcript text in logs, and the
evaluation scorer.

---

## Evaluation

`evaluation/` contains 5 development and 18 held-out synthetic transcripts with **candidate labels that still
need human review**, an annotation rubric and template, a prompt freeze record, a scorer (precision and recall
matched by turn and category, with explicit handling of duplicates, ambiguous cases and zero denominators) and
a runner. No accuracy figures are reported: none have been measured, and a small synthetic set would not
establish real-world reliability anyway. See `evaluation/README.md`.

---

## Limitations

- English transcripts in `Speaker: Message` form only; no timestamps, audio or speaker diarization.
- Three narrow categories. Subtler patterns (interruptions, credit-taking, tone) are out of scope, and no
  findings is not a certificate of an unbiased meeting.
- Findings and summaries are model output. Verification proves the words exist, not that the reading is right.
- Word share is not speaking time and is not a measure of fairness.
- Long meetings near the 40,000-character limit can take a minute or more in live mode.
- The evaluation labels are synthetic candidates until two people annotate and adjudicate them.

---

## Configuration reference (`backend/.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Server-side key for live analysis |
| `ANTHROPIC_MODEL` | — | Model ID, for example `claude-sonnet-5-5` |
| `ANTHROPIC_EFFORT` | model default | `low`, `medium`, `high`, `xhigh` or `max` |
| `PRISM_MAX_TRANSCRIPT_CHARS` | 40000 | Character limit (code points) |
| `PRISM_MAX_UPLOAD_BYTES` | 262144 | Upload and UTF-8 size limit |
| `PRISM_MODEL_TIMEOUT_SECONDS` | 120 | Per model request |
| `PRISM_MAX_OUTPUT_TOKENS` | 16000 | Output cap, including the model's thinking tokens |
| `PRISM_FRONTEND_ORIGIN` | `http://localhost:5173` | The only CORS origin |
| `PRISM_SERVE_FRONTEND` | `true` | Serve `frontend/dist` from the backend when it exists |

## Troubleshooting

- **"Can't reach the PRISM backend"** — start `uvicorn` on port 8000, or set `PRISM_BACKEND_URL` before
  `npm run dev` if it runs elsewhere.
- **"Live analysis isn't set up"** — fill `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in `backend/.env` and restart.
- **"The provider rejected the request"** — the model may not support structured outputs or the chosen effort
  level; try `claude-sonnet-5-5` and remove `ANTHROPIC_EFFORT`.
- **Demo results "need the unedited sample"** — reload the sample; demo fixtures apply only to the exact text.
- **The lens is a flat drawing** — expected on phones, with reduced motion, or when WebGL is unavailable.

---

## Three-minute demonstration script

1. **(0:00) Problem.** "Long meetings are hard to review. PRISM shows participation and points to language worth
   a second look, always with the exact words." Point at the headline and the lens.
2. **(0:20) Format and parsing.** Paste two lines, one without a label, and press **Preview transcript**:
   speakers, turns and the continuation note appear. Then **Load sample → Potential age-based dismissal**.
3. **(0:45) Participation.** In the preview, point out word share per speaker: "words, not speaking time, and
   never a concern by itself."
4. **(1:00) Analyze.** The mode switch shows **Sample demo** (bundled results, no key, nothing sent to a
   provider). Press **Analyze meeting**.
5. **(1:15) Overview.** Metric strip, the chart that settles on exact counts, the validation note ("1 finding
   omitted: the quotation was not found word-for-word"), and the turn-sequence ribbon (order, not time).
6. **(1:40) Language review.** Select **Potential age-based dismissal**: Arun's turn T3 is highlighted.
   Walk through *Explain this flag*: verified quotation (words, not interpretation), context turns, explanation,
   the generated alternative with a visible `[specific technical issue]` placeholder. Note that Sofia's quoted
   stereotype in T9 was not flagged because she rejects it.
7. **(2:10) Review.** Mark the finding **Helpful**, then click again to clear, then **Unsure** with a note.
8. **(2:25) Summary & actions.** Agreed decision with sources, committed vs suggested tasks, "Not specified"
   owner; open a source chip to see the turn.
9. **(2:45) Export and privacy.** **Download report** (transcript excluded by default), then **Clear
   session**. "Live mode uses one configured model on the server; the key never reaches the browser."
