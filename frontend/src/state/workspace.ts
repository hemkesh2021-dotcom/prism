import type { AnalyzeResponse, AppError, Mode, ParseResult, SampleInfo } from "@/lib/types";

/*
 * Session state lives only in memory (this reducer). Nothing here is written to
 * localStorage, sessionStorage, IndexedDB or the URL.
 *
 * Binding rules:
 *  - `version` increases on every transcript change (typing, sample, upload, clear).
 *  - Preview and analysis results remember the version they were computed for.
 *  - An analysis response is accepted only if BOTH its analysis id and the
 *    transcript version still match the running request.
 *  - Reviews belong to one analysis id and are discarded with it.
 */

export type Verdict = "helpful" | "incorrect" | "unsure";

export interface Review {
  verdict: Verdict | null;
  note: string;
}

export type Origin = { kind: "typed" } | { kind: "sample"; sampleId: string } | { kind: "file"; fileName: string };

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; version: number }
  | { status: "ready"; version: number; result: ParseResult }
  | { status: "error"; version: number; error: AppError };

export type AnalysisState =
  | { status: "idle" }
  | { status: "running"; analysisId: string; version: number; mode: Mode; stage: "parsing" | "analyzing" }
  | { status: "done"; analysisId: string; version: number; response: AnalyzeResponse }
  | { status: "error"; analysisId: string; version: number; mode: Mode; error: AppError };

export interface WorkspaceState {
  text: string;
  version: number;
  title: string;
  origin: Origin;
  mode: Mode;
  modeTouched: boolean;
  preview: PreviewState;
  analysis: AnalysisState;
  reviews: Record<string, Review>;
  view: "input" | "results";
}

export type Action =
  | { type: "text/set"; text: string }
  | { type: "text/sample"; sample: SampleInfo }
  | { type: "text/file"; text: string; fileName: string; title: string }
  | { type: "title/set"; title: string }
  | { type: "mode/set"; mode: Mode }
  | { type: "preview/start"; version: number }
  | { type: "preview/success"; version: number; result: ParseResult }
  | { type: "preview/error"; version: number; error: AppError }
  | { type: "analysis/start"; analysisId: string; version: number; mode: Mode; stage: "parsing" | "analyzing" }
  | { type: "analysis/stage"; analysisId: string; stage: "parsing" | "analyzing" }
  | { type: "analysis/success"; analysisId: string; version: number; response: AnalyzeResponse }
  | { type: "analysis/error"; analysisId: string; version: number; error: AppError }
  | { type: "analysis/cancel"; analysisId: string }
  | { type: "analysis/dismiss-error" }
  | { type: "review/set"; analysisId: string; findingId: string; verdict?: Verdict | null; note?: string }
  | { type: "view/set"; view: "input" | "results" }
  | { type: "session/clear" };

export const initialState: WorkspaceState = {
  text: "",
  version: 0,
  title: "",
  origin: { kind: "typed" },
  mode: "live",
  modeTouched: false,
  preview: { status: "idle" },
  analysis: { status: "idle" },
  reviews: {},
  view: "input",
};

/** Any transcript change invalidates results and reviews and supersedes in-flight work. */
function withNewText(state: WorkspaceState, text: string, origin: Origin, title?: string): WorkspaceState {
  return {
    ...state,
    text,
    version: state.version + 1,
    origin,
    title: title ?? state.title,
    preview: state.preview.status === "loading" ? { status: "idle" } : state.preview,
    analysis: { status: "idle" },
    reviews: {},
    view: "input",
  };
}

const isCurrent = (state: WorkspaceState, analysisId: string, version?: number) =>
  state.analysis.status === "running" &&
  state.analysis.analysisId === analysisId &&
  (version === undefined || (state.analysis.version === version && state.version === version));

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "text/set": {
      if (action.text === state.text) return state;
      // Typing over a sample keeps the sample id so the UI can explain why demo mode stopped applying.
      return withNewText(state, action.text, state.origin.kind === "sample" ? state.origin : { kind: "typed" });
    }
    case "text/sample":
      return {
        ...withNewText(state, action.sample.transcript, { kind: "sample", sampleId: action.sample.sample_id }, action.sample.title),
        mode: action.sample.demo_available ? "demo" : state.mode,
      };
    case "text/file":
      return withNewText(state, action.text, { kind: "file", fileName: action.fileName }, action.title);
    case "title/set":
      return { ...state, title: action.title };
    case "mode/set":
      return { ...state, mode: action.mode, modeTouched: true };

    case "preview/start":
      if (action.version !== state.version) return state;
      return { ...state, preview: { status: "loading", version: action.version } };
    case "preview/success":
      if (action.version !== state.version) return state;
      return { ...state, preview: { status: "ready", version: action.version, result: action.result } };
    case "preview/error":
      if (action.version !== state.version) return state;
      return { ...state, preview: { status: "error", version: action.version, error: action.error } };

    case "analysis/start":
      if (state.analysis.status === "running" || action.version !== state.version) return state;
      return {
        ...state,
        analysis: { status: "running", analysisId: action.analysisId, version: action.version, mode: action.mode, stage: action.stage },
        reviews: {},
      };
    case "analysis/stage":
      if (!isCurrent(state, action.analysisId) || state.analysis.status !== "running") return state;
      return { ...state, analysis: { ...state.analysis, stage: action.stage } };
    case "analysis/success":
      if (!isCurrent(state, action.analysisId, action.version) || action.response.analysis_id !== action.analysisId) return state;
      return {
        ...state,
        analysis: { status: "done", analysisId: action.analysisId, version: action.version, response: action.response },
        // The server re-parsed the transcript; keep the preview consistent with the results.
        preview: { status: "ready", version: action.version, result: action.response.parse },
        reviews: {},
        view: "results",
      };
    case "analysis/error":
      if (!isCurrent(state, action.analysisId, action.version) || state.analysis.status !== "running") return state;
      return {
        ...state,
        analysis: { status: "error", analysisId: action.analysisId, version: action.version, mode: state.analysis.mode, error: action.error },
      };
    case "analysis/cancel":
      if (!isCurrent(state, action.analysisId)) return state;
      return { ...state, analysis: { status: "idle" } };
    case "analysis/dismiss-error":
      return state.analysis.status === "error" ? { ...state, analysis: { status: "idle" } } : state;

    case "review/set": {
      if (state.analysis.status !== "done" || state.analysis.analysisId !== action.analysisId) return state;
      const current = state.reviews[action.findingId] ?? { verdict: null, note: "" };
      const next: Review = {
        verdict: action.verdict === undefined ? current.verdict : action.verdict,
        note: action.note === undefined ? current.note : action.note.slice(0, 280),
      };
      return { ...state, reviews: { ...state.reviews, [action.findingId]: next } };
    }

    case "view/set":
      if (action.view === "results" && state.analysis.status !== "done") return state;
      return { ...state, view: action.view };

    case "session/clear":
      // Bump the version so any response still in flight is ignored.
      return { ...initialState, version: state.version + 1 };
  }
}

// ---- selectors -------------------------------------------------------------

export function freshPreview(state: WorkspaceState): ParseResult | null {
  return state.preview.status === "ready" && state.preview.version === state.version ? state.preview.result : null;
}

export function lastPreview(state: WorkspaceState): ParseResult | null {
  return state.preview.status === "ready" ? state.preview.result : null;
}

export function sampleFor(state: WorkspaceState, samples: SampleInfo[]): SampleInfo | null {
  if (state.origin.kind !== "sample") return null;
  const id = state.origin.sampleId;
  return samples.find((s) => s.sample_id === id) ?? null;
}

/** Demo results apply only when the editor holds an unedited bundled sample. */
export function isUneditedSample(state: WorkspaceState, samples: SampleInfo[]): boolean {
  const sample = sampleFor(state, samples);
  return !!sample && sample.demo_available && sample.transcript === state.text;
}
