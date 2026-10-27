import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, toAppError } from "@/lib/api";
import { newAnalysisId } from "@/lib/cn";
import { readTranscriptFile, titleFromFileName } from "@/lib/transcript";
import type { AppError, HealthResponse, SampleInfo } from "@/lib/types";
import { freshPreview, initialState, isUneditedSample, reducer, type Verdict } from "./workspace";

export interface ServiceState {
  status: "loading" | "ready" | "error";
  health: HealthResponse | null;
  samples: SampleInfo[];
  error: AppError | null;
}

const FALLBACK_LIMITS = { max_transcript_chars: 40_000, max_upload_bytes: 256 * 1024 };

export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [service, setService] = useState<ServiceState>({ status: "loading", health: null, samples: [], error: null });
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Latest state for async callbacks; the reducer still re-checks ids and versions.
  const stateRef = useRef(state);
  stateRef.current = state;
  const previewAbort = useRef<AbortController | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const autoPreview = useRef(false);

  const loadService = useCallback(async () => {
    setService((s) => ({ ...s, status: "loading", error: null }));
    try {
      const [health, samples] = await Promise.all([api.health(), api.samples()]);
      setService({ status: "ready", health, samples, error: null });
    } catch (error) {
      setService({ status: "error", health: null, samples: [], error: toAppError(error) });
    }
  }, []);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  // Abort in-flight requests when the transcript they were made for is replaced.
  useEffect(() => {
    previewAbort.current?.abort();
    analysisAbort.current?.abort();
  }, [state.version]);

  const limits = service.health?.limits ?? FALLBACK_LIMITS;
  const demoAvailable = isUneditedSample(state, service.samples);
  const liveAvailable = !!service.health?.live.available;

  // When the editor no longer holds an unedited sample, demo mode cannot apply.
  useEffect(() => {
    if (state.mode === "demo" && !demoAvailable && state.text) dispatch({ type: "mode/set", mode: "live" });
  }, [demoAvailable, state.mode, state.text]);

  const runPreview = useCallback(async (): Promise<boolean> => {
    const { text, version } = stateRef.current;
    if (!text.trim()) return false;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    dispatch({ type: "preview/start", version });
    try {
      const result = await api.parse(text, { signal: controller.signal });
      dispatch({ type: "preview/success", version, result });
      return result.ok;
    } catch (error) {
      if (controller.signal.aborted) return false;
      dispatch({ type: "preview/error", version, error: toAppError(error) });
      return false;
    }
  }, []);

  // Samples and uploads are previewed automatically once the new text is in state.
  // Parsing runs on our own backend; nothing is sent to the AI provider.
  useEffect(() => {
    if (autoPreview.current) {
      autoPreview.current = false;
      void runPreview();
    }
  }, [state.version, runPreview]);

  const analyze = useCallback(async () => {
    const current = stateRef.current;
    if (current.analysis.status === "running" || !current.text.trim()) return; // duplicate-request guard
    const { text, version, mode, origin } = current;
    const analysisId = newAnalysisId();
    const needsParse = !freshPreview(current);
    dispatch({ type: "analysis/start", analysisId, version, mode, stage: needsParse ? "parsing" : "analyzing" });

    const controller = new AbortController();
    analysisAbort.current = controller;

    try {
      if (needsParse) {
        const parsed = await api.parse(text, { signal: controller.signal });
        if (controller.signal.aborted) return; // cancelled or cleared while parsing: never send the paid request
        dispatch({ type: "preview/success", version, result: parsed });
        if (!parsed.ok) {
          dispatch({
            type: "analysis/error",
            analysisId,
            version,
            error: { code: "parse_failed", message: "The transcript has formatting errors. Fix the problems listed in the preview, then analyze again." },
          });
          return;
        }
        dispatch({ type: "analysis/stage", analysisId, stage: "analyzing" });
      }
      const timeoutMs = ((service.health?.request_timeout_seconds ?? 255) + 10) * 1000;
      const response = await api.analyze(
        { transcript: text, mode, analysis_id: analysisId, sample_id: origin.kind === "sample" ? origin.sampleId : null },
        { signal: controller.signal, timeoutMs },
      );
      dispatch({ type: "analysis/success", analysisId, version, response });
    } catch (error) {
      if (controller.signal.aborted) return; // cancelled or superseded: nothing to report
      dispatch({ type: "analysis/error", analysisId, version, error: toAppError(error) });
    } finally {
      if (analysisAbort.current === controller) analysisAbort.current = null;
    }
  }, [service.health]);

  const cancelAnalysis = useCallback(() => {
    const current = stateRef.current;
    if (current.analysis.status !== "running") return;
    analysisAbort.current?.abort();
    dispatch({ type: "analysis/cancel", analysisId: current.analysis.analysisId });
  }, []);

  const loadSample = useCallback(
    (sample: SampleInfo) => {
      setUploadError(null);
      autoPreview.current = true;
      dispatch({ type: "text/sample", sample });
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      const result = await readTranscriptFile(file, limits.max_upload_bytes);
      if (!result.ok) {
        setUploadError(result.message);
        return;
      }
      autoPreview.current = true;
      dispatch({ type: "text/file", text: result.text, fileName: result.name, title: titleFromFileName(result.name) });
    },
    [limits.max_upload_bytes],
  );

  const setText = useCallback((text: string) => {
    setUploadError(null);
    dispatch({ type: "text/set", text });
  }, []);

  const clearSession = useCallback(() => {
    previewAbort.current?.abort();
    analysisAbort.current?.abort();
    setUploadError(null);
    dispatch({ type: "session/clear" });
  }, []);

  const setReview = useCallback((findingId: string, change: { verdict?: Verdict | null; note?: string }) => {
    const current = stateRef.current;
    if (current.analysis.status !== "done") return;
    dispatch({ type: "review/set", analysisId: current.analysis.analysisId, findingId, ...change });
  }, []);

  return {
    state,
    dispatch,
    service,
    limits,
    liveAvailable,
    demoAvailable,
    uploadError,
    actions: {
      reloadService: loadService,
      setText,
      setTitle: (title: string) => dispatch({ type: "title/set", title }),
      setMode: (mode: "live" | "demo") => dispatch({ type: "mode/set", mode }),
      loadSample,
      uploadFile,
      preview: runPreview,
      analyze,
      cancelAnalysis,
      dismissError: () => dispatch({ type: "analysis/dismiss-error" }),
      showInput: () => dispatch({ type: "view/set", view: "input" }),
      showResults: () => dispatch({ type: "view/set", view: "results" }),
      setReview,
      clearSession,
    },
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
