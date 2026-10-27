import type { Review } from "@/state/workspace";
import {
  ACTION_LABEL,
  CATEGORY_LABEL,
  CHARACTERISTIC_NOUN,
  NOT_SPECIFIED,
  findingTitle,
  formatInt,
  formatShare,
  formatTimestamp,
  isIdentityCategory,
  slugify,
} from "./format";
import { canonicalize } from "./transcript";
import type { AnalyzeResponse, Evidence } from "./types";

export interface ReportInput {
  response: AnalyzeResponse;
  reviews: Record<string, Review>;
  title: string;
  transcript: string;
  includeTranscript: boolean;
  generatedAt: Date;
}

const VERDICT_TEXT = { helpful: "Helpful", incorrect: "Incorrect", unsure: "Unsure" } as const;

/** Escape characters that Markdown would otherwise interpret inside running text. */
export function mdInline(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1");
}

/** Text inside a table cell: inline-escaped, with pipes escaped (done by mdInline). */
const cell = (text: string) => mdInline(text) || " ";

/** A blockquote that survives Markdown special characters at line starts. */
export function mdQuote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${mdInline(line).replace(/^([#>+-]|\d+\.)/, "\\$1")}`)
    .join("\n");
}

function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = "`".repeat(longest + 1);
  return `${marker}text\n${text}\n${marker}`;
}

const sourceText = (sources: Evidence[]) =>
  sources.map((s) => `${s.turn_id} (${mdInline(s.speaker_label)}): “${mdInline(s.quote)}”`).join("; ");

export function buildReport({ response, reviews, title, transcript, includeTranscript, generatedAt }: ReportInput): string {
  const { parse, analysis } = response;
  const meetingTitle = title.trim() || "Untitled meeting";
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);

  push(`# PRISM report: ${mdInline(meetingTitle)}`, "");
  push("Meeting Communication & Bias Analyzer", "");
  push(`- **Report generated:** ${formatTimestamp(generatedAt)}`);
  push(
    `- **Mode:** ${
      response.mode === "demo"
        ? "Sample demo (bundled fixture for an unedited sample; not a model run)"
        : "Live analysis"
    }`,
  );
  if (response.mode === "live") push(`- **Model:** ${mdInline(response.model ?? "unknown")}`);
  push(`- **Prompt version:** ${mdInline(response.prompt_version)}`);
  push(`- **Transcript grammar:** version ${mdInline(parse.grammar_version)}`);
  push(`- **Analysis ID:** ${mdInline(response.analysis_id)}`);
  push(`- **Analysis completed (server time, UTC):** ${mdInline(response.generated_at)}`);
  push(`- **Transcript fingerprint (SHA-256):** ${response.transcript_hash}`);
  push("");
  push(
    "> PRISM points to language that may be worth reviewing and backs each point with an exact quotation. It does not determine whether anyone is biased. “Quotation verified” means the words appear in the cited turn; the interpretation is model-generated and needs human judgment.",
    "",
  );

  // ---- participation ------------------------------------------------------
  push("## Participation", "");
  push(`Speakers represented: ${formatInt(parse.speakers.length)}. Turns: ${formatInt(parse.total_turns)}. Words: ${formatInt(parse.total_words)}.`, "");
  push("| Speaker | Words | Word share | Turns |", "| --- | ---: | ---: | ---: |");
  for (const s of parse.speakers) {
    push(`| ${cell(s.label)} | ${formatInt(s.words)} | ${formatShare(s.word_share)} | ${formatInt(s.turns)} |`);
  }
  push("");
  push("Word share counts words in the transcript, not speaking time. Shares are rounded for display and may not sum to exactly 100%. Unequal participation is not treated as a concern on its own.", "");

  // ---- findings -----------------------------------------------------------
  push("## Potential concerns (model findings)", "");
  const reviewedCount = analysis.findings.filter((f) => reviews[f.finding_id]?.verdict).length;
  if (analysis.findings.length === 0) {
    if (response.findings_returned > 0) {
      push(
        `The model reported ${response.findings_returned} potential concern(s), but none of their quotations could be verified in the cited turns, so none are listed. This is not an all-clear; review the transcript manually.`,
        "",
      );
    } else {
      push("No potential concerns were identified in this transcript. This does not certify that the meeting was free of bias.", "");
    }
  } else {
    const tally = (v: keyof typeof VERDICT_TEXT) => analysis.findings.filter((f) => reviews[f.finding_id]?.verdict === v).length;
    push(
      `${analysis.findings.length} finding(s) with verified quotations. Reviewed: ${reviewedCount} of ${analysis.findings.length} (Helpful ${tally("helpful")}, Incorrect ${tally("incorrect")}, Unsure ${tally("unsure")}).`,
      "",
    );
    for (const finding of analysis.findings) {
      const review = reviews[finding.finding_id];
      const label = `${CATEGORY_LABEL[finding.category]}${
        finding.identity_characteristic ? ` (${CHARACTERISTIC_NOUN[finding.identity_characteristic]})` : ""
      }`;
      push(`### ${finding.finding_id}: ${findingTitle(finding)}`, "");
      push(`- **Category:** ${isIdentityCategory(finding.category) ? `Identity-related; ${label}` : label}`);
      push(`- **Speaker:** ${mdInline(finding.evidence.speaker_label)}, turn ${finding.evidence.turn_id}`);
      push(`- **Quotation (verified in ${finding.evidence.turn_id}):**`, "");
      push(mdQuote(finding.evidence.quote), "");
      push(`- **Explanation (model):** ${mdInline(finding.explanation)}`);
      if (finding.context_note) push(`- **Context note (model):** ${mdInline(finding.context_note)}`);
      push(`- **Suggested alternative (generated, not a quotation):** ${mdInline(finding.alternative_wording)}`);
      if (review?.verdict) {
        push(`- **Reviewer annotation:** ${VERDICT_TEXT[review.verdict]}${review.note.trim() ? `. Note: ${mdInline(review.note.trim())}` : ""}`);
      } else if (review?.note.trim()) {
        push(`- **Reviewer annotation:** No verdict. Note: ${mdInline(review.note.trim())}`);
      } else {
        push("- **Reviewer annotation:** Not reviewed");
      }
      push("");
    }
  }

  // ---- summary ------------------------------------------------------------
  push("## Discussion summary", "");
  if (analysis.discussion_points.length === 0) push("No discussion points could be verified.", "");
  analysis.discussion_points.forEach((point, i) => {
    push(`${i + 1}. ${mdInline(point.text)}`, `   - Sources: ${sourceText(point.sources)}`);
  });
  if (analysis.discussion_points.length) push("");

  push("## Decisions", "");
  for (const status of ["agreed", "proposed"] as const) {
    const items = analysis.decisions.filter((d) => d.status === status);
    push(`### ${status === "agreed" ? "Agreed" : "Proposed, not agreed"}`, "");
    if (!items.length) push(status === "agreed" ? "Nothing was clearly agreed." : "No open proposals.", "");
    for (const d of items) push(`- ${mdInline(d.text)}`, `  - Sources: ${sourceText(d.sources)}`);
    if (items.length) push("");
  }

  push("## Action items", "");
  if (analysis.action_items.length === 0) {
    push("No action items were identified.", "");
  } else {
    push("| Task | Owner | Deadline | Status | Sources |", "| --- | --- | --- | --- | --- |");
    for (const a of analysis.action_items) {
      push(
        `| ${cell(a.task)} | ${cell(a.owner ?? NOT_SPECIFIED)} | ${cell(a.deadline ?? NOT_SPECIFIED)} | ${ACTION_LABEL[a.status]} | ${a.sources
          .map((s) => s.turn_id)
          .join(", ")} |`,
      );
    }
    push("", "Owners and deadlines appear only when the transcript states them; relative deadlines are kept as written.", "");
  }

  push("## Suggestions", "");
  if (analysis.suggestions.length === 0) push("No suggestions.", "");
  for (const s of analysis.suggestions) {
    const basis =
      s.basis === "general" ? "General guidance" : s.related_finding_id ? `Related to ${s.related_finding_id}` : "Based on cited turns";
    push(`- ${mdInline(s.text)} (${basis}${s.sources.length ? `; sources: ${s.sources.map((x) => x.turn_id).join(", ")}` : ""})`);
  }
  if (analysis.suggestions.length) push("");

  // ---- notices & method ---------------------------------------------------
  push("## Validation notices", "");
  if (response.notices.length === 0) push("All model output passed evidence validation.", "");
  for (const notice of response.notices) push(`- ${mdInline(notice.message)}`);
  if (response.notices.length) push("");

  push("## Method and limitations", "");
  push(
    "- Parsing and participation statistics are deterministic (Python). The language model never counts.",
    "- Findings and summaries are generated by a language model, then validated: each quotation must occur verbatim in the turn it cites, and the speaker is taken from the parsed transcript. Items that fail are omitted and reported above, never repaired.",
    "- Owners and deadlines must appear in the transcript; otherwise they are shown as “Not specified”.",
    "- Findings cover three narrow categories: identity-based stereotyping, identity-based dismissal, and personal attacks or dismissive communication. No findings does not certify an unbiased meeting.",
    "- Reviewer annotations are a person's judgment and are recorded separately from the model's findings.",
    "- Any accuracy figures from PRISM's small synthetic evaluation set do not establish real-world reliability.",
    "",
  );

  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!includeTranscript) return body;
  // The appendix is appended verbatim (canonical text), outside the whitespace tidy-up above.
  return `${body}\n## Appendix: full transcript\n\n${fence(canonicalize(transcript))}\n`;
}

export function reportFileName(title: string, generatedAt: Date): string {
  const slug = slugify(title);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(generatedAt.getHours())}${pad(generatedAt.getMinutes())}`;
  return `prism-report-${slug}-${stamp}.md`;
}
