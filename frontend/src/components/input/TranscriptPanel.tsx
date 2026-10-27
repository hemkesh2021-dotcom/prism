import { IconArrowBackUp, IconChevronDown, IconFileText, IconListSearch, IconLoader2, IconUpload } from "@tabler/icons-react";
import { useEffect, useId, useRef } from "react";
import { ErrorCallout, LiveSetupSteps } from "@/components/common/ErrorCallout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { scrollBehavior, useMotionPreference } from "@/lib/motion";
import { countCharacters } from "@/lib/transcript";
import type { SampleInfo } from "@/lib/types";
import type { Workspace } from "@/state/useWorkspace";
import { freshPreview, sampleFor } from "@/state/workspace";

const RETRYABLE = new Set(["timeout", "client_timeout", "rate_limited", "malformed_output", "provider_unreachable", "provider_unavailable", "backend_unavailable", "output_truncated"]);

export function TranscriptPanel({ workspace }: { workspace: Workspace }) {
  const { state, service, limits, liveAvailable, demoAvailable, uploadError, actions } = workspace;
  const editorId = useId();
  const countId = useId();
  const discloseId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPreference();

  const running = state.analysis.status === "running";
  const chars = countCharacters(state.text);
  const overLimit = chars > limits.max_transcript_chars;
  const hasText = state.text.trim().length > 0;
  const preview = freshPreview(state);
  const parseBlocked = preview ? !preview.ok : false;
  const serviceDown = service.status === "error";
  const loadedSample = sampleFor(state, service.samples);
  const editedSample = loadedSample && !demoAvailable && state.text !== loadedSample.transcript;

  const liveBlocked = state.mode === "live" && !liveAvailable;
  const canAnalyze = hasText && !overLimit && !running && !parseBlocked && !serviceDown && !liveBlocked && service.status === "ready";
  const resultsReady = state.analysis.status === "done" && state.view === "input";
  const errorKey = state.analysis.status === "error" ? `${state.analysis.analysisId}-${state.analysis.error.code}` : null;

  // A failed analysis is reported next to the Analyze button; bring it into view if it landed below the fold.
  useEffect(() => {
    if (errorKey) errorRef.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior(reduced) });
  }, [errorKey, reduced]);

  return (
    <section className="panel-lg p-5 sm:p-6" aria-labelledby="transcript-heading">
      {serviceDown && service.error && (
        <ErrorCallout
          className="mb-5"
          error={service.error}
          actions={
            <Button size="sm" variant="secondary" onClick={() => void actions.reloadService()}>
              Try again
            </Button>
          }
        />
      )}

      {resultsReady && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-teal/20 bg-teal-soft px-4 py-3">
          <p className="text-[14px] font-medium text-ink">Results for this transcript are still available.</p>
          <Button size="sm" variant="secondary" onClick={actions.showResults}>
            <IconArrowBackUp size={16} stroke={2} aria-hidden />
            View results
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="transcript-heading" className="text-[17px] font-bold tracking-[-0.01em]">
          Transcript
        </h2>
        <div className="flex flex-wrap gap-2">
          <SampleMenu samples={service.samples} disabled={running || service.status !== "ready"} onSelect={actions.loadSample} />
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={running}>
            <IconUpload size={18} stroke={1.75} aria-hidden />
            Upload .txt
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void actions.uploadFile(file);
            }}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={`${editorId}-title`} className="text-[13px] font-semibold text-ink">
          Meeting title <span className="font-normal text-ink-2">(optional, used in the report)</span>
        </label>
        <input
          id={`${editorId}-title`}
          value={state.title}
          onChange={(e) => actions.setTitle(e.target.value.slice(0, 120))}
          placeholder="Untitled meeting"
          className="mt-1.5 h-11 w-full rounded-control border border-ink/12 bg-surface px-3.5 text-[15px] shadow-[inset_0_1px_2px_rgb(76_66_46/0.06)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal/25"
          disabled={running}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={editorId} className="text-[13px] font-semibold text-ink">
          Transcript text
        </label>
        <textarea
          id={editorId}
          value={state.text}
          onChange={(e) => actions.setText(e.target.value)}
          readOnly={running}
          spellCheck={false}
          aria-describedby={`${countId} ${discloseId}`}
          aria-invalid={overLimit || undefined}
          placeholder={"Arun: Let's review the caching proposal.\nMeera: Sure. I'll start with the benchmark results."}
          className={cn(
            "well mt-1.5 block min-h-[240px] w-full resize-y !bg-[#f3f2ec] px-4 py-3.5 text-[15px] leading-[1.65] text-ink outline-none transition-[box-shadow,border-color]",
            "placeholder:text-ink-3 focus-visible:border-teal/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal/20",
            "sm:min-h-[280px]",
            running && "opacity-75",
          )}
          style={{ maxHeight: "60vh" }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
          <p id={countId} className={cn("tnum", overLimit ? "font-semibold text-brick" : "text-ink-2")}>
            {formatInt(chars)} of {formatInt(limits.max_transcript_chars)} characters
            {overLimit && " — over the limit. Shorten or split the transcript; PRISM never truncates."}
          </p>
          <p className="text-ink-2">
            Format: <span className="font-semibold text-ink">Speaker: Message</span>
          </p>
        </div>
        {uploadError && (
          <p role="alert" className="mt-2 rounded-[12px] bg-brick-soft px-3 py-2 text-[13.5px] text-brick">
            {uploadError}
          </p>
        )}
        {editedSample && (
          <p className="mt-2 text-[13px] text-ink-2">
            This text no longer matches the “{loadedSample.title}” sample, so its demo results don't apply.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-ink/8 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
        <Button variant="secondary" onClick={() => void actions.preview()} disabled={!hasText || overLimit || running || serviceDown}>
          <IconListSearch size={18} stroke={1.75} aria-hidden />
          Preview transcript
        </Button>
        <div className="flex flex-col gap-3 sm:ml-auto sm:flex-row sm:items-center">
          <Segmented
            label="Analysis mode"
            layoutGroup="mode"
            value={state.mode}
            onValueChange={(mode) => mode && actions.setMode(mode)}
            options={[
              { value: "live", label: "Live analysis" },
              { value: "demo", label: "Sample demo", disabled: !demoAvailable },
            ]}
            className="w-full sm:w-auto"
            optionClassName="whitespace-nowrap"
          />
          <Button
            variant="primary"
            size="lg"
            className="min-w-[11.5rem] aria-disabled:cursor-progress"
            onClick={() => {
              if (!running) void actions.analyze();
            }}
            disabled={!canAnalyze && !running}
            aria-disabled={running || undefined}
            aria-describedby={discloseId}
          >
            {running && <IconLoader2 size={18} stroke={2} className="motion-safe:animate-spin" aria-hidden />}
            {running ? "Analyzing…" : "Analyze meeting"}
          </Button>
        </div>
      </div>

      <div id={discloseId} className="mt-3 space-y-1 text-[13px] leading-relaxed text-ink-2">
        <p>Live analysis sends this transcript to the configured AI provider. This app does not save your meeting history.</p>
        {state.mode === "demo" && <p>Sample demo uses bundled results for the unedited sample. Nothing is sent to an AI provider.</p>}
        {state.mode === "live" && !demoAvailable && hasText && service.samples.length > 0 && !loadedSample && (
          <p>Sample demo is available for the bundled samples only.</p>
        )}
        {parseBlocked && <p className="font-medium text-brick">Fix the formatting errors in the preview before analyzing.</p>}
      </div>

      {service.status === "ready" && liveBlocked && hasText && (
        <div className="mt-4 rounded-[16px] border border-ink/10 bg-surface/80 p-4 text-[14px]">
          <p className="font-semibold">Live analysis isn't set up on this server</p>
          <p className="mt-1 text-ink-2">
            The sample demo works without a key. To analyze your own transcripts:
          </p>
          <LiveSetupSteps missing={service.health?.live.missing} />
        </div>
      )}

      {state.analysis.status === "error" && (
        <ErrorCallout
          ref={errorRef}
          className="mt-4 scroll-mb-6"
          error={state.analysis.error}
          actions={
            <>
              {RETRYABLE.has(state.analysis.error.code) && (
                <Button size="sm" variant="primary" onClick={() => void actions.analyze()} disabled={!canAnalyze}>
                  Try again
                </Button>
              )}
              {state.analysis.error.code === "demo_requires_unedited_sample" && loadedSample && (
                <Button size="sm" variant="secondary" onClick={() => actions.loadSample(loadedSample)}>
                  <IconFileText size={16} stroke={1.75} aria-hidden />
                  Reload the sample
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={actions.dismissError}>
                Dismiss
              </Button>
            </>
          }
        >
          {state.analysis.error.code === "live_not_configured" && <LiveSetupSteps missing={service.health?.live.missing} />}
          {state.analysis.error.code !== "live_not_configured" && state.analysis.error.code !== "parse_failed" && (
            <p className="mt-2 text-[13px] text-ink-2">Your transcript and its participation statistics are unchanged.</p>
          )}
        </ErrorCallout>
      )}
    </section>
  );
}

function SampleMenu({ samples, disabled, onSelect }: { samples: SampleInfo[]; disabled: boolean; onSelect: (s: SampleInfo) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" disabled={disabled || samples.length === 0}>
          <IconFileText size={18} stroke={1.75} aria-hidden />
          Load sample
          <IconChevronDown size={16} stroke={2} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px]">
        <DropdownMenuLabel>Bundled samples, each with demo results</DropdownMenuLabel>
        {samples.map((sample) => (
          <DropdownMenuItem key={sample.sample_id} onSelect={() => onSelect(sample)}>
            <span>
              <span className="block font-semibold">{sample.title}</span>
              <span className="block text-[13px] leading-snug text-ink-2">{sample.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
