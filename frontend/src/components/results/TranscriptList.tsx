import { memo, useEffect, useMemo, useRef } from "react";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { cn } from "@/lib/cn";
import { findingTitle } from "@/lib/format";
import { scrollBehavior, useMotionPreference } from "@/lib/motion";
import type { Evidence, Finding, Turn } from "@/lib/types";
import { findingTone, useResults, type ActiveHighlight } from "./context";
import { TurnText } from "./TurnText";

/** Every parsed turn, with the active quotation highlighted and scrolled into view. */
export function TranscriptList({ className }: { className?: string }) {
  const { turns, colors, highlight, response, selectFinding, selectedFindingId } = useResults();
  const { reduced } = useMotionPreference();
  const container = useRef<HTMLDivElement>(null);

  const findingsByTurn = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of response.analysis.findings) {
      const list = map.get(finding.evidence.turn_id) ?? [];
      list.push(finding);
      map.set(finding.evidence.turn_id, list);
    }
    return map;
  }, [response.analysis.findings]);

  useEffect(() => {
    if (!highlight || !highlight.scroll) return;
    const element = container.current?.querySelector<HTMLElement>(`[data-turn-id="${highlight.turnId}"]`);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: scrollBehavior(reduced) });
    if (highlight.focus) element.focus({ preventScroll: true });
  }, [highlight, reduced]);

  return (
    <div ref={container} className={cn("space-y-1", className)}>
      {turns.map((turn) => {
        const active = highlight?.turnId === turn.turn_id;
        const turnFindings = findingsByTurn.get(turn.turn_id);
        // Rows only receive values that concern them, so typing a review note or moving the
        // highlight re-renders one or two rows rather than the whole transcript.
        return (
          <TurnRow
            key={turn.turn_id}
            turn={turn}
            color={colors.get(turn.speaker_id) ?? "#6b7470"}
            evidence={active ? (highlight?.evidence ?? null) : null}
            tone={active && highlight && highlight.tone !== "turn" ? highlight.tone : "source"}
            nonce={active ? highlight?.nonce : undefined}
            active={active}
            findings={turnFindings}
            selectedFindingId={turnFindings ? selectedFindingId : null}
            onSelectFinding={turnFindings ? selectFinding : undefined}
          />
        );
      })}
    </div>
  );
}

interface TurnRowProps {
  turn: Turn;
  color: string;
  evidence: Evidence | null;
  tone: Exclude<ActiveHighlight["tone"], "turn">;
  nonce: number | undefined;
  active: boolean;
  findings: Finding[] | undefined;
  selectedFindingId: string | null;
  onSelectFinding: ((findingId: string) => void) | undefined;
}

const TurnRow = memo(function TurnRow({ turn, color, evidence, tone, nonce, active, findings, selectedFindingId, onSelectFinding }: TurnRowProps) {
  return (
    <article
      id={`turn-${turn.turn_id}`}
      data-turn-id={turn.turn_id}
      tabIndex={-1}
      aria-label={`Turn ${turn.turn_id.slice(1)}, ${turn.speaker_label}`}
      className={cn(
        "relative scroll-mt-24 rounded-[14px] py-3 pl-5 pr-3 outline-none transition-[background-color,box-shadow] duration-300",
        active ? "bg-surface shadow-control" : "hover:bg-surface/50",
        "focus-visible:ring-2 focus-visible:ring-teal",
      )}
    >
      <span className="absolute bottom-3 left-2 top-3 w-[3px] rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="turn-id">{turn.turn_id}</span>
        <SpeakerTag label={turn.speaker_label} color={color} className="text-[14px]" />
        {findings?.map((finding) => (
          <button
            key={finding.finding_id}
            type="button"
            onClick={() => onSelectFinding?.(finding.finding_id)}
            aria-pressed={selectedFindingId === finding.finding_id}
            aria-label={`${finding.finding_id}: ${findingTitle(finding)}`}
            className={cn(
              "relative inline-flex h-6 items-center rounded-full px-2 text-[11.5px] font-bold transition-shadow duration-200 after:absolute after:-inset-2.5 after:content-['']",
              findingTone(finding) === "identity" ? "bg-amber-soft text-amber-ink" : "bg-slate-soft text-slate",
              selectedFindingId === finding.finding_id && "ring-2 ring-teal",
            )}
          >
            {finding.finding_id}
          </button>
        ))}
      </div>
      <TurnText
        text={turn.text}
        evidence={evidence}
        tone={tone}
        animateKey={nonce}
        className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-ink"
      />
    </article>
  );
});
