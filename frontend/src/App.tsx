import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { InputView } from "@/components/input/InputView";
import { Header } from "@/components/layout/Header";
import { pluralize } from "@/lib/format";
import { durations, ease } from "@/lib/motion";
import { useWorkspace } from "@/state/useWorkspace";

// Results (charts, review panels) load separately so the first screen stays light.
const loadResults = () => import("@/components/results/ResultsView");
const ResultsView = lazy(() => loadResults().then((m) => ({ default: m.ResultsView })));

export default function App() {
  const workspace = useWorkspace();
  const { state, service, actions } = workspace;
  const announcement = useAnnouncement(workspace);
  const mainRef = useRef<HTMLElement>(null);

  const showResults = state.view === "results" && state.analysis.status === "done";

  // Fetch the results code in the background once the first screen is idle (and at the latest when an
  // analysis starts), so the completion transition never waits on a download.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadResults());
  }, []);
  useEffect(() => {
    if (state.analysis.status === "running") void loadResults();
  }, [state.analysis.status]);
  const hasSessionData = state.text.length > 0 || state.analysis.status !== "idle";

  // Move focus to the new view's heading so keyboard and screen-reader users land in the right place.
  // Compare with the previous view rather than skipping the first run: StrictMode runs effects twice on mount.
  const shownView = useRef(showResults);
  useEffect(() => {
    if (shownView.current === showResults) return;
    shownView.current = showResults;
    window.scrollTo({ top: 0 });
    if (showResults) return; // ResultsView focuses its own heading once its code has loaded
    const id = window.setTimeout(() => mainRef.current?.querySelector<HTMLElement>("h1")?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [showResults]);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only left-4 top-3 z-50 rounded-control bg-surface px-4 py-2.5 font-semibold text-ink shadow-control focus:not-sr-only focus:absolute"
      >
        Skip to content
      </a>
      <Header
        hasSessionData={hasSessionData}
        onClearSession={actions.clearSession}
        promptVersion={service.health?.prompt_version}
        appVersion={service.health?.app_version}
      />
      <main id="main" ref={mainRef} className="[&_h1]:outline-none">
        {/* Each view animates in on its own; nothing waits on an exit animation. */}
        {showResults && state.analysis.status === "done" ? (
          <motion.div
            key={`results-${state.analysis.analysisId}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.entrance, ease }}
          >
            <Suspense fallback={<p className="mx-auto max-w-[1320px] px-4 py-10 text-ink-2 sm:px-6 lg:px-10">Preparing results…</p>}>
              <ResultsView workspace={workspace} response={state.analysis.response} />
            </Suspense>
          </motion.div>
        ) : (
          <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: durations.panel, ease }}>
            <InputView workspace={workspace} />
          </motion.div>
        )}
      </main>
      <footer className="mx-auto max-w-[1320px] px-4 pb-10 text-[12.5px] leading-relaxed text-ink-2 sm:px-6 lg:px-10">
        PRISM highlights language that may be worth reviewing. It does not determine whether anyone is biased.
      </footer>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}

/** Short status messages for assistive technology. */
function useAnnouncement({ state }: ReturnType<typeof useWorkspace>): string {
  const [message, setMessage] = useState("");
  const previewKey = state.preview.status === "ready" ? `${state.preview.version}-${state.preview.result.transcript_hash}` : state.preview.status;
  const analysisKey = state.analysis.status === "idle" ? "idle" : `${state.analysis.status}-${state.analysis.analysisId}`;

  useEffect(() => {
    if (state.preview.status === "ready") {
      const r = state.preview.result;
      setMessage(
        r.ok
          ? `Preview ready: ${pluralize(r.speakers.length, "speaker")}, ${pluralize(r.total_turns, "turn")}, ${pluralize(r.total_words, "word")}.`
          : "Preview found formatting errors. See the preview panel.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  useEffect(() => {
    if (state.analysis.status === "done") {
      const { analysis, findings_returned } = state.analysis.response;
      const n = analysis.findings.length;
      const summary =
        n > 0
          ? `${pluralize(n, "potential concern")} to review.`
          : findings_returned > 0
            ? "No findings could be verified against the transcript, so none are shown. This is not an all-clear."
            : "No potential concerns were identified in this transcript.";
      setMessage(`Analysis complete. ${summary}`);
    } else if (state.analysis.status === "error") {
      setMessage(`Analysis stopped: ${state.analysis.error.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey]);

  return message;
}
