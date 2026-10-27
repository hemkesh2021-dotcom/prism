# Bundled samples and demo fixtures

| Sample | File | What it shows |
| --- | --- | --- |
| Neutral planning | `neutral-planning.txt` | Owners, deadlines ("by Thursday", "next Friday"), a proposal that is not yet agreed, a task without an owner, a continuation line and a later colon. No findings. |
| Technical disagreement | `technical-disagreement.txt` | Firm, direct disagreement settled by agreeing to benchmark. Disagreement alone is not a finding. |
| Potential age-based dismissal | `age-dismissal.txt` | An age-based dismissal, a separate dismissive remark, a quoted stereotype that the speaker rejects, curly apostrophes and an emoji before a quoted span. |

`catalog.json` lists the samples for the app (`GET /api/samples`).

## Demo fixtures

`fixtures/*.analysis.json` hold **hand-written** demonstration output in the same schema the model must follow.
They were not produced by a language model and say nothing about model accuracy.

Each fixture records the SHA-256 of its sample's canonical text (`sample_sha256`). The backend:

1. serves a fixture only when the submitted transcript is byte-for-byte the unedited sample (after the same BOM
   and line-ending normalization used everywhere else);
2. refuses to serve a fixture whose `sample_sha256` no longer matches the sample file;
3. runs the fixture through the same schema validation and evidence validation as live output.

The age-dismissal fixture deliberately includes one paraphrased quotation, so the demo shows evidence validation
rejecting it ("1 finding was omitted because the quotation was not found word-for-word in the cited turn").

If you edit a sample, update its fixture's quotations and print the new hash with:

```bash
cd backend && .venv/bin/python -c "from prism.parsing import canonicalize, transcript_hash; import sys; print(transcript_hash(canonicalize(open(sys.argv[1], encoding='utf-8').read())))" ../samples/<file>.txt
```
