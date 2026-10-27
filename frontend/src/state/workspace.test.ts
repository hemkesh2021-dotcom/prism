import { describe, expect, it } from "vitest";
import type { AnalyzeResponse, ParseResult, SampleInfo } from "@/lib/types";
import { initialState, isUneditedSample, reducer, type WorkspaceState } from "./workspace";

const parse = (hash = "h"): ParseResult => ({
  ok: true,
  grammar_version: "1",
  transcript_hash: hash,
  char_count: 10,
  line_count: 1,
  total_words: 2,
  total_turns: 1,
  speakers: [],
  turns: [],
  issues: [],
});

const response = (analysisId: string): AnalyzeResponse => ({
  analysis_id: analysisId,
  mode: "demo",
  sample_id: "s",
  model: null,
  prompt_version: "analysis-v1.0",
  generated_at: "2026-10-26T10:00:00+00:00",
  transcript_hash: "h",
  attempts: 0,
  findings_returned: 0,
  parse: parse(),
  analysis: { findings: [], discussion_points: [], decisions: [], action_items: [], suggestions: [] },
  notices: [],
});

function started(text = "A: hi"): WorkspaceState {
  const typed = reducer(initialState, { type: "text/set", text });
  return reducer(typed, { type: "analysis/start", analysisId: "run-1", version: typed.version, mode: "live", stage: "analyzing" });
}

describe("response gating", () => {
  it("accepts a response only when analysis id and transcript version both match", () => {
    const state = started();
    const done = reducer(state, { type: "analysis/success", analysisId: "run-1", version: state.version, response: response("run-1") });
    expect(done.analysis.status).toBe("done");
    expect(done.view).toBe("results");
  });

  it("ignores a stale response after the transcript changed", () => {
    const state = started();
    const edited = reducer(state, { type: "text/set", text: "A: hi there" });
    const late = reducer(edited, { type: "analysis/success", analysisId: "run-1", version: state.version, response: response("run-1") });
    expect(late.analysis.status).toBe("idle");
    expect(late).toBe(edited);
  });

  it("ignores a response for a different analysis id", () => {
    const state = started();
    const wrong = reducer(state, { type: "analysis/success", analysisId: "run-0", version: state.version, response: response("run-0") });
    expect(wrong.analysis.status).toBe("running");
  });

  it("does not start a second analysis while one is running", () => {
    const state = started();
    const again = reducer(state, { type: "analysis/start", analysisId: "run-2", version: state.version, mode: "live", stage: "analyzing" });
    expect(again.analysis.status === "running" && again.analysis.analysisId).toBe("run-1");
  });

  it("clearing the session invalidates in-flight work", () => {
    const state = started();
    const cleared = reducer(state, { type: "session/clear" });
    expect(cleared.text).toBe("");
    expect(cleared.version).toBeGreaterThan(state.version);
    const late = reducer(cleared, { type: "analysis/success", analysisId: "run-1", version: state.version, response: response("run-1") });
    expect(late.analysis.status).toBe("idle");
  });
});

describe("reviews are bound to one analysis", () => {
  const done = () => {
    const state = started();
    return reducer(state, { type: "analysis/success", analysisId: "run-1", version: state.version, response: response("run-1") });
  };

  it("records, changes and clears a verdict", () => {
    let state = reducer(done(), { type: "review/set", analysisId: "run-1", findingId: "F1", verdict: "helpful", note: "Fair" });
    expect(state.reviews.F1).toEqual({ verdict: "helpful", note: "Fair" });
    state = reducer(state, { type: "review/set", analysisId: "run-1", findingId: "F1", verdict: null });
    expect(state.reviews.F1).toEqual({ verdict: null, note: "Fair" });
  });

  it("ignores reviews for another analysis and drops reviews when the text changes", () => {
    const state = reducer(done(), { type: "review/set", analysisId: "run-1", findingId: "F1", verdict: "unsure" });
    expect(reducer(state, { type: "review/set", analysisId: "old", findingId: "F1", verdict: "incorrect" }).reviews.F1.verdict).toBe("unsure");
    const edited = reducer(state, { type: "text/set", text: "B: new meeting" });
    expect(edited.reviews).toEqual({});
    expect(edited.analysis.status).toBe("idle");
  });

  it("a fresh analysis starts with no reviews", () => {
    const reviewed = reducer(done(), { type: "review/set", analysisId: "run-1", findingId: "F1", verdict: "helpful" });
    const rerun = reducer(reviewed, { type: "analysis/start", analysisId: "run-2", version: reviewed.version, mode: "live", stage: "analyzing" });
    expect(rerun.reviews).toEqual({});
  });
});

describe("demo availability", () => {
  const sample: SampleInfo = { sample_id: "s", title: "Sample", description: "", transcript: "A: hi\nB: yo", demo_available: true };

  it("is available only while the sample text is unedited", () => {
    const loaded = reducer(initialState, { type: "text/sample", sample });
    expect(loaded.mode).toBe("demo");
    expect(isUneditedSample(loaded, [sample])).toBe(true);
    const edited = reducer(loaded, { type: "text/set", text: "A: hi\nB: yo!" });
    expect(isUneditedSample(edited, [sample])).toBe(false);
    const reverted = reducer(edited, { type: "text/set", text: sample.transcript });
    expect(isUneditedSample(reverted, [sample])).toBe(true);
  });
});
