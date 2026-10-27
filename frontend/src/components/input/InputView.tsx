import { IconX } from "@tabler/icons-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { durations, ease, panelTransition, useMotionPreference } from "@/lib/motion";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { LensPlayToggle, LensStage } from "@/scene/LensStage";
import type { Workspace } from "@/state/useWorkspace";
import { PreviewPanel } from "./PreviewPanel";
import { TranscriptPanel } from "./TranscriptPanel";

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: durations.entrance, ease, delay },
});

export function InputView({ workspace }: { workspace: Workspace }) {
  const { state, actions } = workspace;
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { reduced } = useMotionPreference();
  const running = state.analysis.status === "running";
  const stage = state.analysis.status === "running" ? state.analysis.stage : null;

  const status = running && (
    <AnalysisStatus stage={stage ?? "analyzing"} mode={state.analysis.status === "running" ? state.analysis.mode : "live"} onCancel={actions.cancelAnalysis} inPanel={desktop} />
  );

  return (
    <div className="mx-auto grid max-w-[1320px] gap-6 px-4 pb-16 pt-2 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10 lg:px-10 lg:pt-5">
      <div className="min-w-0 space-y-6">
        <motion.div {...enter(0)} className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 tabIndex={-1} className="text-[34px] font-[720] leading-[1.04] tracking-[-0.035em] text-ink sm:text-[44px] lg:text-[52px]">
              See the conversation clearly.
            </h1>
            <p className="mt-3 max-w-[44rem] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
              Explore participation, review potential concerns, and capture what comes next.
            </p>
          </div>
          {!desktop && <LensStage variant="hero" className="h-[88px] w-[88px] shrink-0 sm:h-[140px] sm:w-[140px]" focus={running} />}
        </motion.div>

        <motion.div {...enter(0.08)}>
          <TranscriptPanel workspace={workspace} />
        </motion.div>

        {!desktop && status}
      </div>

      <div className="min-w-0 space-y-6">
        {desktop && (
          <motion.div {...enter(0.04)} className="panel overflow-hidden">
            {/* One scene instance: it shrinks into its compact form while an analysis runs. The canvas
                keeps its size and is scaled, so WebGL never reallocates buffers mid-transition. */}
            <div
              className={cn("relative overflow-hidden", !reduced && "transition-[height] duration-300 ease-out-soft", running ? "h-[150px]" : "h-[300px]")}
            >
              <div
                className={cn("absolute inset-x-0 top-0 h-[300px] origin-top", !reduced && "transition-transform duration-300 ease-out-soft")}
                style={running ? { transform: "scale(0.5)" } : undefined}
              >
                <LensStage variant="panel" focus={running} control={false} className="mx-auto h-full w-full max-w-[460px]" />
              </div>
              {!reduced && <LensPlayToggle className="bottom-3 right-3 h-11 w-11" />}
            </div>
            {status}
          </motion.div>
        )}
        <motion.div {...enter(0.12)}>
          <PreviewPanel preview={state.preview} version={state.version} hasText={state.text.trim().length > 0} onPreview={() => void actions.preview()} />
        </motion.div>
      </div>
    </div>
  );
}

function AnalysisStatus({
  stage,
  mode,
  onCancel,
  inPanel,
}: {
  stage: "parsing" | "analyzing";
  mode: "live" | "demo";
  onCancel: () => void;
  inPanel: boolean;
}) {
  const message = stage === "parsing" ? "Parsing transcript…" : mode === "demo" ? "Loading sample demo results…" : "Analyzing language and summary…";
  return (
    <motion.div
      key="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={panelTransition}
      className={inPanel ? "border-t border-ink/8 px-6 pb-5 pt-4" : "panel p-5"}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="text-[16px] font-semibold text-ink">{message}</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
          {mode === "live"
            ? "This can take up to a minute for long meetings. The transcript stays as it is."
            : "Demo results come from a bundled fixture checked by the same validation."}
        </p>
        <Button size="sm" variant="ghost" className="-ml-3 mt-2" onClick={onCancel}>
          <IconX size={16} stroke={2} aria-hidden />
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}
