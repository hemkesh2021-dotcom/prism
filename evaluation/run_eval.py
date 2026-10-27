"""Run PRISM's live analysis on an evaluation set and score the verified findings.

Usage (from the repository root, with the backend virtual environment):

    backend/.venv/bin/python evaluation/run_eval.py --set dev
    backend/.venv/bin/python evaluation/run_eval.py --set heldout --labels evaluation/heldout/labels.human.json
    backend/.venv/bin/python evaluation/run_eval.py --score-only evaluation/runs/<run-folder> --labels <labels.json>

(On Windows use backend\\.venv\\Scripts\\python.exe.)

Live runs need ANTHROPIC_API_KEY and ANTHROPIC_MODEL in backend/.env and are paid
usage. The held-out set is refused unless the prompt file still matches
evaluation/prompt_freeze.json. Outputs (verified findings and validation notices
only, no transcripts) are written to evaluation/runs/<timestamp>/.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(EVAL_DIR))

from scoring import format_report, load_labels, score  # noqa: E402


def run_live(set_name: str, out_dir: Path) -> dict[str, list[dict] | None]:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / "backend" / ".env")
    from prism.analysis import instruction_fingerprint, run_live_analysis
    from prism.config import load_settings
    from prism.errors import PrismError
    from prism.parsing import check_transcript_input, parse_transcript, canonicalize
    from prism.prompts import load_prompt
    from prism.provider import AnthropicProvider
    from prism.validation import validate_analysis

    settings = load_settings()
    if not settings.live_available:
        sys.exit("Live analysis is not configured. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in backend/.env.")

    prompt = load_prompt()
    freeze = json.loads((EVAL_DIR / "prompt_freeze.json").read_text(encoding="utf-8"))
    fingerprint = instruction_fingerprint()
    frozen = (
        prompt.version == freeze["prompt_version"]
        and prompt.sha256 == freeze["prompt_sha256"]
        and fingerprint == freeze["instructions_sha256"]
    )
    if set_name == "heldout" and not frozen:
        sys.exit(
            "The model instructions (prompt file, output schema descriptions or message wrapper) differ from "
            "evaluation/prompt_freeze.json. The held-out set may only be run with the frozen instructions; restore "
            "them, or create a new prompt version and freeze record before evaluating."
        )

    provider = AnthropicProvider(
        api_key=settings.anthropic_api_key or "",
        model=settings.anthropic_model or "",
        effort=settings.anthropic_effort,
        timeout_seconds=settings.model_timeout_seconds,
        max_output_tokens=settings.max_output_tokens,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "run.json").write_text(
        json.dumps(
            {
                "set": set_name,
                "model": settings.anthropic_model,
                "effort": settings.anthropic_effort,
                "prompt_version": prompt.version,
                "prompt_sha256": prompt.sha256,
                "instructions_sha256": fingerprint,
                "prompt_frozen": frozen,
                "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    predictions: dict[str, list[dict] | None] = {}
    for path in sorted((EVAL_DIR / set_name).glob("*.txt")):
        transcript_id = path.stem
        canonical = canonicalize(path.read_text(encoding="utf-8"))
        record: dict = {"transcript_id": transcript_id}
        try:
            check_transcript_input(canonical, settings)
            parsed = parse_transcript(canonical)
            live = run_live_analysis(parsed, provider, timeout_seconds=settings.model_timeout_seconds)
            content, notices = validate_analysis(live.output, parsed)
            findings = [
                {
                    "turn_id": f.evidence.turn_id,
                    "category": f.category,
                    "identity_characteristic": f.identity_characteristic,
                    "quote": f.evidence.quote,
                }
                for f in content.findings
            ]
            record.update(
                attempts=live.attempts,
                findings_returned=len(live.output.findings),
                findings=findings,
                notices=[n.model_dump() for n in notices],
                action_items=[a.model_dump(include={"task", "owner", "deadline", "status"}) for a in content.action_items],
            )
            predictions[transcript_id] = findings
            print(f"  {transcript_id}: {len(findings)} verified finding(s)")
        except PrismError as error:
            record.update(error={"code": error.code, "message": error.message})
            predictions[transcript_id] = None
            print(f"  {transcript_id}: failed ({error.code})")
        (out_dir / f"{transcript_id}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return predictions


def load_run(run_dir: Path) -> dict[str, list[dict] | None]:
    predictions: dict[str, list[dict] | None] = {}
    for path in sorted(run_dir.glob("*.json")):
        if path.name in {"run.json", "score.json"}:
            continue
        record = json.loads(path.read_text(encoding="utf-8"))
        predictions[record["transcript_id"]] = None if "error" in record else record["findings"]
    return predictions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", choices=["dev", "heldout"], help="Evaluation set to run live.")
    parser.add_argument("--labels", type=Path, help="Labels file (defaults to <set>/labels.candidate.json).")
    parser.add_argument("--score-only", type=Path, help="Score an existing run folder without calling the model.")
    args = parser.parse_args()

    if args.score_only:
        run_dir = args.score_only
        info = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
        set_name = info["set"]
        predictions = load_run(run_dir)
    elif args.set:
        set_name = args.set
        run_dir = EVAL_DIR / "runs" / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{set_name}"
        print(f"Running live analysis on the {set_name} set...")
        predictions = run_live(set_name, run_dir)
        info = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    else:
        parser.error("choose --set or --score-only")

    labels_path = args.labels or EVAL_DIR / set_name / "labels.candidate.json"
    labels, label_status = load_labels(labels_path)
    report = score(predictions, labels)
    run_info = (
        f"Set: {set_name}. Model: {info.get('model')}. Prompt: {info.get('prompt_version')} "
        f"({'frozen' if info.get('prompt_frozen') else 'NOT frozen'}). Labels: {labels_path.name}."
    )
    markdown = format_report(report, label_status=label_status, run_info=run_info)
    (run_dir / "score.md").write_text(markdown, encoding="utf-8")
    (run_dir / "score.json").write_text(json.dumps(report.to_dict(), indent=2) + "\n", encoding="utf-8")
    print()
    print(markdown)


if __name__ == "__main__":
    main()
