# PRISM evaluation kit

This folder measures how well the **language findings** match labelled transcripts. It contains no results:
nothing here has been run against a live model, and no accuracy figures are claimed anywhere in the project.

## Contents

| Path | What it is |
| --- | --- |
| `dev/` | 5 development transcripts used while writing the prompt, with candidate labels. |
| `heldout/` | 18 held-out transcripts, kept out of prompt development, with candidate labels. |
| `*/labels.candidate.json` | **Synthetic candidate labels** written by an AI assistant together with the transcripts. They have not been verified by people. |
| `rubric.md` | Annotation guidelines for human annotators. |
| `annotation_template.csv` | One row per finding, for two independent annotators. |
| `prompt_freeze.json` | Version and SHA-256 of the analysis prompt, plus a fingerprint of all model instructions (prompt, output schema with field descriptions, message wrapper, repair note), frozen for evaluation. |
| `scoring.py` | Matching rules and metrics (tested in `backend/tests/test_scoring.py`). |
| `run_eval.py` | Runs live analysis on a set and scores it, or re-scores a saved run. |

All transcripts are synthetic. They cover neutral meetings, blunt technical disagreement, seniority without
identity, explicit identity dismissal (age, disability), stereotyping (gender, nationality, religion), personal
attacks, quoted, reported and rebutted stereotypes, a hypothetical training example, negation, an ambiguous
teasing case, missing task owners, and instructions embedded in the transcript (prompt injection).

## Procedure

1. **Annotate.** Two people label every transcript with `rubric.md` and `annotation_template.csv`, without
   seeing model output. Adjudicate disagreements and save the result as `heldout/labels.human.json` (same shape
   as the candidate file, with `"label_status": "human_adjudicated"`).
2. **Freeze.** The prompt in `backend/prism/prompts/analysis_v1.md` and the other model instructions are
   frozen in `prompt_freeze.json`. `run_eval.py` refuses to run the held-out set if any of them has changed; a
   test also fails. To change them, create a new `PROMPT_VERSION` and a new freeze record, and evaluate again.
3. **Run.** Configure `backend/.env` (paid API usage), then from the repository root:

   ```bash
   backend/.venv/bin/python evaluation/run_eval.py --set heldout --labels evaluation/heldout/labels.human.json
   ```

   On Windows: `backend\.venv\Scripts\python.exe evaluation\run_eval.py --set heldout ...`
4. **Re-score** a saved run with different labels, without new model calls:

   ```bash
   backend/.venv/bin/python evaluation/run_eval.py --score-only evaluation/runs/<run-folder> --labels <labels.json>
   ```

Runs are saved in `evaluation/runs/` (git-ignored): one JSON file per transcript with the verified findings,
validation notices and action items, plus `score.md` and `score.json`. Transcripts themselves are not copied.

## Matching and metrics

- A prediction is a **correct flag** when the transcript, source turn and category match a required label.
- Anything else the model reports is a **false alarm**, except matches with **optional** (ambiguous) labels,
  which are neither rewarded nor penalized.
- A required label with no matching prediction is a **miss**.
- Predictions are first collapsed by turn and category, so duplicates count once; the number collapsed is
  reported.
- Precision = correct / (correct + false alarms). Recall = correct / (correct + misses). When a denominator is
  zero the value is reported as "n/a", never as 0 or 1.
- Only **verified** findings are scored: a finding whose quotation failed evidence validation never reaches the
  score, and validation notices are saved for inspection.
- A transcript whose run failed (timeout, malformed output) is listed as "not scored"; it is never silently
  treated as an empty result.
- The identity characteristic does not affect matching; mismatches are listed per transcript.

## Limits

Eighteen short synthetic transcripts are enough to catch regressions and obvious failure modes, not to estimate
real-world reliability. Real meetings are longer, messier and more ambiguous. Report any numbers together with
the label status, the model ID, the prompt version and the date, and do not describe candidate labels as human
labels.
