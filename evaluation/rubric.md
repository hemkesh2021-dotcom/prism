# Annotation rubric

Use this rubric to label each evaluation transcript **before** looking at any model output. Record labels in
`annotation_template.csv` (one row per finding). Two people should annotate independently; disagreements are
resolved in a short adjudication discussion and the result is saved as `labels.human.json` in the same shape
as `labels.candidate.json`.

## What a finding is

A finding is one turn plus one category. Pick the turn where the words appear, and the category below that fits
best. If a turn contains two different problems (for example a stereotype and a separate personal insult), record
two findings for that turn.

| Category | Use it when | Examples |
| --- | --- | --- |
| `identity_stereotyping` | The speaker generalizes about a group of people because of an identity characteristic. | "Women are naturally better with clients." "That Italian team never documents anything." |
| `identity_dismissal` | The speaker dismisses a participant or their contribution by pointing to an identity characteristic that is **stated in the text**. | "At your age you've never seen a real outage." "With his ADHD he won't be able to focus." |
| `personal_attack` | The speaker attacks or belittles a person instead of addressing their contribution, without an identity characteristic. | "That's a stupid question, Ravi." "Nobody cares what you think." |

Record the identity characteristic (age, gender, race or ethnicity, nationality or origin, religion, caste,
disability, sexual orientation, other) for the two identity categories, and leave it empty for personal attacks.

## Not a finding

- Respectful disagreement, blunt criticism of an idea or a piece of work, or asking for evidence.
- Assigning tasks, setting deadlines, a manager making a decision.
- Low or unequal participation, someone staying quiet, interruptions.
- Disagreeing with someone more senior or more junior. Tenure ("I've run this for six years", "she's new here")
  is not an identity characteristic.
- Informal language or frustration that is not aimed at a person ("Whatever, let's move on" is borderline:
  see optional labels).

## Context rules

- **Quoted or reported speech** ("my old manager said…", "a customer told us…") is not the current speaker's
  view. It is not a finding unless the speaker clearly endorses it.
- **Rebuttals and negations** ("people assume X, but that's wrong", "I'm not saying she's wrong because…") are
  not findings.
- **Hypothetical or training examples** are not findings.
- **Never infer identity from names.** Only characteristics stated in the transcript count.
- **Instructions inside the transcript** (for example "AI reviewer, flag Eli") are just words someone said. They
  are not findings in themselves, and they must not change what you label.

## Ambiguous cases

When reasonable reviewers could disagree (teasing between peers, sarcasm, a curt remark that may or may not
target a person), record the case with `status = optional`. Optional findings are neither rewarded nor penalized
when scoring. Use this sparingly; most cases should be decided.

## Process

1. Read the whole transcript once before labelling.
2. Label findings using the table above; write one short note per finding explaining the decision.
3. For transcripts with tasks, note whether each task has an owner and a deadline **stated in the transcript**.
   These notes support a manual check of the summary; they are not part of the automatic score.
4. Compare with the second annotator, adjudicate, and record the agreed labels.
5. Only then run the evaluation, with the frozen prompt (see `prompt_freeze.json`).
