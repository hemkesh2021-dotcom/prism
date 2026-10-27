import { describe, expect, it } from "vitest";
import { buildReport, mdInline, mdQuote, reportFileName } from "./report";
import type { AnalyzeResponse, Evidence } from "./types";

const evidence = (turn_id: string, speaker_label: string, quote: string): Evidence => ({
  turn_id,
  speaker_id: speaker_label === "Arun" ? "S1" : "S2",
  speaker_label,
  quote,
  highlight: { start: 0, end: quote.length, occurrences: 1 },
});

const response: AnalyzeResponse = {
  analysis_id: "analysis-1234",
  mode: "live",
  sample_id: null,
  model: "claude-sonnet-5-5",
  prompt_version: "analysis-v1.0",
  generated_at: "2026-10-26T10:00:00+00:00",
  transcript_hash: "abc123",
  attempts: 1,
  findings_returned: 2,
  parse: {
    ok: true,
    grammar_version: "1",
    transcript_hash: "abc123",
    char_count: 120,
    line_count: 3,
    total_words: 18,
    total_turns: 3,
    speakers: [
      { speaker_id: "S1", label: "Arun", order: 0, words: 12, turns: 2, word_share: 12 / 18 },
      { speaker_id: "S2", label: "Meera", order: 1, words: 6, turns: 1, word_share: 6 / 18 },
    ],
    turns: [],
    issues: [],
  },
  analysis: {
    findings: [
      {
        finding_id: "F1",
        category: "identity_dismissal",
        identity_characteristic: "age",
        evidence: evidence("T1", "Arun", "You are too young to understand this architecture."),
        explanation: "This may dismiss the proposal by pointing to age.",
        context_note: null,
        alternative_wording: "My concern with the proposal is [specific technical issue].",
      },
    ],
    discussion_points: [{ item_id: "P1", text: "Caching *strategy* for orders", sources: [evidence("T2", "Meera", "benchmark it")] }],
    decisions: [{ item_id: "D1", text: "Benchmark first", status: "agreed", sources: [evidence("T2", "Meera", "benchmark it")] }],
    action_items: [
      { item_id: "A1", task: "Write the benchmark", owner: null, deadline: "next Friday", status: "committed", sources: [evidence("T2", "Meera", "benchmark it")] },
    ],
    suggestions: [{ item_id: "S1", text: "Name the concern first.", basis: "evidence", related_finding_id: "F1", sources: [] }],
  },
  notices: [{ section: "findings", code: "quote_not_found", count: 1, message: "1 finding was omitted because the quotation was not found word-for-word in the cited turn." }],
};

const base = {
  response,
  reviews: { F1: { verdict: "incorrect" as const, note: "He later named a real concern" } },
  title: "Architecture | review",
  transcript: "Arun: You are too young to understand this architecture.\n\n\n\nMeera: Let us benchmark it.",
  includeTranscript: false,
  generatedAt: new Date(2026, 9, 26, 14, 5),
};

describe("Markdown report", () => {
  it("matches the dashboard: metadata, participation, findings, review status, summary, notices", () => {
    const md = buildReport(base);
    expect(md).toContain("# PRISM report: Architecture \\| review");
    expect(md).toContain("- **Mode:** Live analysis");
    expect(md).toContain("- **Model:** claude-sonnet-5-5");
    expect(md).toContain("- **Prompt version:** analysis-v1.0");
    expect(md).toContain("| Arun | 12 | 66.7% | 2 |");
    expect(md).toContain("### F1: Potential age-based dismissal");
    expect(md).toContain("> You are too young to understand this architecture.");
    expect(md).toContain("- **Reviewer annotation:** Incorrect. Note: He later named a real concern");
    expect(md).toContain("Reviewed: 1 of 1 (Helpful 0, Incorrect 1, Unsure 0)");
    expect(md).toContain("Suggested alternative (generated, not a quotation):** My concern with the proposal is \\[specific technical issue\\].");
    expect(md).toContain("| Write the benchmark | Not specified | next Friday | Committed | T2 |");
    expect(md).toContain("Caching \\*strategy\\* for orders");
    expect(md).toContain("1 finding was omitted because the quotation was not found word-for-word");
    expect(md).not.toContain("## Appendix: full transcript");
  });

  it("names each finding's category once, with the identity group only for identity categories", () => {
    const attack = {
      ...response.analysis.findings[0],
      finding_id: "F2",
      category: "personal_attack" as const,
      identity_characteristic: null,
    };
    const md = buildReport({ ...base, response: { ...response, analysis: { ...response.analysis, findings: [response.analysis.findings[0], attack] } } });
    expect(md).toContain("- **Category:** Identity-related; Identity-based dismissal (age)");
    expect(md).toContain("- **Category:** Personal attack or dismissive communication\n");
  });

  it("includes the full transcript only on request, verbatim", () => {
    const md = buildReport({ ...base, includeTranscript: true });
    expect(md).toContain("## Appendix: full transcript");
    expect(md).toContain("architecture.\n\n\n\nMeera: Let us benchmark it.");
  });

  it("says no concerns without certifying the meeting, and flags unverified output", () => {
    const empty = { ...response, findings_returned: 0, analysis: { ...response.analysis, findings: [] } };
    expect(buildReport({ ...base, response: empty })).toContain(
      "No potential concerns were identified in this transcript. This does not certify that the meeting was free of bias.",
    );
    const unverified = { ...response, findings_returned: 2, analysis: { ...response.analysis, findings: [] } };
    expect(buildReport({ ...base, response: unverified })).toContain("This is not an all-clear");
  });

  it("labels demo mode and never includes credentials", () => {
    const md = buildReport({ ...base, response: { ...response, mode: "demo", model: null } });
    expect(md).toContain("Sample demo (bundled fixture for an unedited sample; not a model run)");
    expect(md).not.toMatch(/api[_-]?key|sk-ant/i);
  });

  it("escapes Markdown in running text and quotes", () => {
    expect(mdInline("a|b *c* [d]")).toBe("a\\|b \\*c\\* \\[d\\]");
    expect(mdQuote("# not a heading\n- not a list")).toBe("> \\# not a heading\n> \\- not a list");
  });

  it("builds a readable file name", () => {
    expect(reportFileName("Design review: Payments", base.generatedAt)).toBe("prism-report-design-review-payments-20261026-1405.md");
  });
});
