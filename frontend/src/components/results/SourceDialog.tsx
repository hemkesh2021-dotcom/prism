import { IconCircleCheck, IconListDetails } from "@tabler/icons-react";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import type { Evidence } from "@/lib/types";
import { useResults } from "./context";
import { TurnText } from "./TurnText";

/** Clickable reference to a verified source quotation. */
export function SourceChip({ evidence }: { evidence: Evidence }) {
  const { colors, openSource } = useResults();
  return (
    <button
      type="button"
      onClick={() => openSource(evidence)}
      className="relative inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-surface px-2.5 text-[12.5px] font-semibold text-ink shadow-[0_1px_2px_rgb(76_66_46/0.08)] transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:border-teal/40 hover:bg-teal-soft"
      aria-label={`Source ${evidence.turn_id}, ${evidence.speaker_label}: ${evidence.quote}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors.get(evidence.speaker_id) }} aria-hidden />
      <span className="font-mono text-[11.5px] font-medium">{evidence.turn_id}</span>
      <span className="truncate font-medium text-ink-2">{evidence.speaker_label}</span>
    </button>
  );
}

export function SourceList({ sources, className }: { sources: Evidence[]; className?: string }) {
  if (!sources.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[12.5px] text-ink-2">Sources</span>
      {sources.map((evidence) => (
        <SourceChip key={`${evidence.turn_id}-${evidence.highlight.start}-${evidence.highlight.end}`} evidence={evidence} />
      ))}
    </div>
  );
}

export function SourceDialog({ evidence, onOpenChange }: { evidence: Evidence | null; onOpenChange: (open: boolean) => void }) {
  const { turns, turnIndex, colors, showInTranscript } = useResults();
  const position = evidence ? turnIndex.get(evidence.turn_id) ?? 0 : 0;
  const context = evidence ? [turns[position - 1], turns[position], turns[position + 1]].filter(Boolean) : [];

  return (
    <Dialog open={!!evidence} onOpenChange={onOpenChange}>
      {evidence && (
        <DialogContent
          wide
          title={`Source turn ${evidence.turn_id}`}
          description="The supporting quotation in its place in the transcript."
        >
          <ol className="space-y-3">
            {context.map((turn) => {
              const isSource = turn.turn_id === evidence.turn_id;
              return (
                <li key={turn.turn_id} className={cn("rounded-[14px] p-3", isSource ? "well" : "text-ink-2")}>
                  <span className="flex items-center gap-2 text-[13.5px]">
                    <span className="turn-id">{turn.turn_id}</span>
                    <SpeakerTag label={turn.speaker_label} color={colors.get(turn.speaker_id) ?? "#6b7470"} strong={isSource} />
                  </span>
                  <TurnText
                    text={turn.text}
                    evidence={isSource ? evidence : null}
                    tone="source"
                    animateKey={isSource ? 1 : undefined}
                    className="mt-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed"
                  />
                </li>
              );
            })}
          </ol>
          <p className="mt-4 flex items-start gap-1.5 text-[13px] leading-snug text-ink-2">
            <IconCircleCheck size={16} stroke={2} className="mt-px shrink-0 text-teal" aria-hidden />
            <span>
              <span className="font-semibold text-ink">Quotation verified</span> in {evidence.turn_id}. It supports the item for your
              review; it doesn't prove the summary's interpretation is right.
            </span>
          </p>
          <div className="mt-5 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
                showInTranscript(evidence.turn_id, evidence, "source");
              }}
            >
              <IconListDetails size={18} stroke={1.75} aria-hidden />
              Show in full transcript
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
