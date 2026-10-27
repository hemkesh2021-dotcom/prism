import { IconCircleCheck, IconShieldQuestion } from "@tabler/icons-react";
import { motion } from "motion/react";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { cn } from "@/lib/cn";
import { GROUP_LABEL, findingTitle, pluralize } from "@/lib/format";
import { panelTransition } from "@/lib/motion";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { Finding } from "@/lib/types";
import { findingTone, useResults } from "./context";
import { ExplainPanel, VERDICT_LABEL } from "./ExplainPanel";
import { TranscriptList } from "./TranscriptList";

export function LanguageReviewTab() {
  const { response, selectedFindingId, findingsById, showInTranscript } = useResults();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const findings = response.analysis.findings;
  const selected = selectedFindingId ? findingsById.get(selectedFindingId) ?? null : null;
  const identity = findings.filter((f) => findingTone(f) === "identity");
  const personal = findings.filter((f) => findingTone(f) === "personal");

  const viewInContext = (finding: Finding) => showInTranscript(finding.evidence.turn_id, finding.evidence, findingTone(finding));

  const transcript = (
    <section aria-labelledby="transcript-review-heading" className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="transcript-review-heading" className="text-[17px] font-bold tracking-[-0.01em]">
          Transcript
        </h3>
        <p className="text-[13px] text-ink-2">{pluralize(response.parse.total_turns, "turn")}, in order</p>
      </div>
      <div className={cn("well p-2 sm:p-3", desktop && "max-h-[calc(100vh-150px)] overflow-y-auto overscroll-contain")}>
        <TranscriptList />
      </div>
    </section>
  );

  const side = (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="findings-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="findings-heading" className="text-[17px] font-bold tracking-[-0.01em]">
            Potential concerns
          </h3>
          <p className="text-[13px] text-ink-2">Model findings, quotes verified</p>
        </div>
        {findings.length === 0 ? (
          <EmptyFindings returned={response.findings_returned} />
        ) : (
          <div className="mt-3 space-y-5">
            {identity.length > 0 && <FindingGroup title={GROUP_LABEL.identity} findings={identity} />}
            {personal.length > 0 && <FindingGroup title={GROUP_LABEL.personal} findings={personal} />}
          </div>
        )}
      </section>

      {/* The new explanation replaces the old one at once and settles in; nothing waits on an exit. */}
      {selected && (
        <motion.div key={selected.finding_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={panelTransition}>
          <ExplainPanel finding={selected} onViewInContext={() => viewInContext(selected)} />
        </motion.div>
      )}
      {!selected && findings.length > 0 && (
        <p className="rounded-[16px] border border-dashed border-ink/15 px-4 py-3 text-[14px] text-ink-2">
          Select a finding to see its quotation in context, the explanation and a suggested alternative.
        </p>
      )}
    </div>
  );

  return desktop ? (
    <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-8">
      {transcript}
      <div className="sticky top-4 max-h-[calc(100vh-32px)] overflow-y-auto overscroll-contain px-1 pb-4">{side}</div>
    </div>
  ) : (
    <div className="space-y-8">
      {side}
      {transcript}
    </div>
  );
}

function FindingGroup({ title, findings }: { title: string; findings: Finding[] }) {
  const { selectedFindingId, selectFinding, colors, reviews } = useResults();
  return (
    <div>
      <h4 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-2">
        <span
          className={cn("h-2.5 w-2.5 rounded-full", findingTone(findings[0]) === "identity" ? "bg-amber" : "bg-slate")}
          aria-hidden
        />
        {title}
        <span className="tnum font-normal">({findings.length})</span>
      </h4>
      <ul className="mt-2 space-y-2">
        {findings.map((finding) => {
          const selected = finding.finding_id === selectedFindingId;
          const verdict = reviews[finding.finding_id]?.verdict;
          return (
            <li key={finding.finding_id}>
              <button
                type="button"
                onClick={() => selectFinding(selected ? null : finding.finding_id)}
                aria-pressed={selected}
                className={cn(
                  "w-full rounded-[16px] border px-4 py-3 text-left transition-[background-color,box-shadow,border-color] duration-200",
                  selected
                    ? "border-teal/40 bg-surface shadow-control ring-2 ring-teal/25"
                    : "border-ink/8 bg-surface/60 hover:border-ink/15 hover:bg-surface",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-[14.5px] font-semibold leading-snug text-ink">{findingTitle(finding)}</span>
                  <span className="turn-id shrink-0">{finding.finding_id}</span>
                </span>
                <span className="mt-1.5 line-clamp-2 block text-[14px] leading-relaxed text-ink-2">“{finding.evidence.quote}”</span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <SpeakerTag label={finding.evidence.speaker_label} color={colors.get(finding.evidence.speaker_id) ?? "#6b7470"} />
                  <span className="turn-id">{finding.evidence.turn_id}</span>
                  <span className={cn("ml-auto font-medium", verdict ? "text-teal" : "text-ink-2")}>
                    {verdict ? `Reviewed: ${VERDICT_LABEL[verdict]}` : "Not reviewed"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyFindings({ returned }: { returned: number }) {
  if (returned > 0) {
    return (
      <div className="mt-3 rounded-[16px] border border-amber/40 bg-amber-soft/60 p-4" role="status">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <IconShieldQuestion size={20} stroke={1.75} className="text-amber-ink" aria-hidden />
          No findings could be verified
        </p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          The model reported {pluralize(returned, "potential concern")}, but none of the quotations matched the cited turns, so
          nothing is shown. This is not an all-clear: read the transcript yourself or run the analysis again.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-[16px] border border-teal/20 bg-teal-soft/60 p-4" role="status">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <IconCircleCheck size={20} stroke={1.75} className="text-teal" aria-hidden />
        No potential concerns were identified in this transcript.
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
        This doesn't certify that the meeting was free of bias. The model looks for three narrow kinds of language; read the
        transcript for anything it may have missed.
      </p>
    </div>
  );
}
