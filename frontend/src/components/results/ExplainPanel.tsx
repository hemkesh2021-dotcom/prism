import { IconCheck, IconCircleCheck, IconCopy, IconEye, IconMessageCircleUser, IconUserExclamation } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { Wording } from "@/components/common/Wording";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, CHARACTERISTIC_NOUN, GROUP_LABEL, findingTitle } from "@/lib/format";
import type { Finding } from "@/lib/types";
import type { Verdict } from "@/state/workspace";
import { findingTone, useResults } from "./context";
import { TurnText } from "./TurnText";

const VERDICT_LABEL: Record<Verdict, string> = { helpful: "Helpful", incorrect: "Incorrect", unsure: "Unsure" };

export function CategoryBadge({ finding, className }: { finding: Finding; className?: string }) {
  const identity = findingTone(finding) === "identity";
  const Icon = identity ? IconMessageCircleUser : IconUserExclamation;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold",
        identity ? "bg-amber-soft text-amber-ink" : "bg-slate-soft text-slate",
        className,
      )}
    >
      <Icon size={15} stroke={2} aria-hidden />
      {identity ? GROUP_LABEL.identity : "Personal or dismissive"}
    </span>
  );
}

export function ExplainPanel({ finding, onViewInContext }: { finding: Finding; onViewInContext: () => void }) {
  const { turns, turnIndex, colors, reviews, setReview, highlight } = useResults();
  const headingId = useId();
  const noteId = useId();
  const review = reviews[finding.finding_id] ?? { verdict: null, note: "" };
  const position = turnIndex.get(finding.evidence.turn_id) ?? 0;
  const context = [turns[position - 1], turns[position], turns[position + 1]].filter(Boolean);
  const tone = findingTone(finding);
  const color = colors.get(finding.evidence.speaker_id) ?? "#6b7470";

  return (
    <section aria-labelledby={headingId} className="panel-lg p-5 sm:p-6">
      <p className="text-[13px] font-semibold text-ink-2">Explain this flag</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <h3 id={headingId} className="text-[20px] font-bold leading-snug tracking-[-0.015em] text-ink">
          {findingTitle(finding)}
        </h3>
        <span className="turn-id mt-1.5">{finding.finding_id}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CategoryBadge finding={finding} />
        <span className="text-[13px] text-ink-2">
          {CATEGORY_LABEL[finding.category]}
          {finding.identity_characteristic && ` (${CHARACTERISTIC_NOUN[finding.identity_characteristic]})`}
        </span>
      </div>

      <figure className="well mt-5 p-4">
        <blockquote className="text-[16.5px] font-medium leading-relaxed text-ink">
          <span aria-hidden>“</span>
          {finding.evidence.quote}
          <span aria-hidden>”</span>
        </blockquote>
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px]">
          <SpeakerTag label={finding.evidence.speaker_label} color={color} />
          <span className="text-ink-2">
            Source turn <span className="turn-id">{finding.evidence.turn_id}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={onViewInContext} className="ml-auto">
            <IconEye size={16} stroke={1.75} aria-hidden />
            View quotation in context
          </Button>
        </figcaption>
      </figure>
      <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-ink-2">
        <IconCircleCheck size={16} stroke={2} className="mt-px shrink-0 text-teal" aria-hidden />
        <span>
          <span className="font-semibold text-ink">Quotation verified:</span> these exact words appear in {finding.evidence.turn_id}.
          That confirms the words, not the interpretation.
          {finding.evidence.highlight.occurrences > 1 &&
            ` The phrase occurs ${finding.evidence.highlight.occurrences} times in this turn; the first is highlighted.`}
        </span>
      </p>

      <section className="mt-6">
        <h4 className="text-[14px] font-semibold text-ink">Surrounding context</h4>
        <ol className="mt-2 space-y-2 border-l-2 border-ink/8 pl-3">
          {context.map((turn) => {
            const isSource = turn.turn_id === finding.evidence.turn_id;
            return (
              <li key={turn.turn_id} className={cn("text-[14px] leading-relaxed", !isSource && "text-ink-2")}>
                <span className="flex items-center gap-2">
                  <span className="turn-id">{turn.turn_id}</span>
                  <SpeakerTag label={turn.speaker_label} color={colors.get(turn.speaker_id) ?? "#6b7470"} strong={isSource} />
                </span>
                <TurnText
                  text={turn.text}
                  evidence={isSource ? finding.evidence : null}
                  tone={tone}
                  animateKey={isSource ? highlight?.nonce : undefined}
                  className={cn("mt-0.5 whitespace-pre-wrap break-words", !isSource && "line-clamp-3")}
                />
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-6">
        <h4 className="text-[14px] font-semibold text-ink">Why it may be worth reviewing</h4>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink">{finding.explanation}</p>
        {finding.context_note && (
          <p className="mt-2 rounded-[12px] bg-porcelain-deep/70 px-3 py-2 text-[13.5px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Context: </span>
            {finding.context_note}
          </p>
        )}
        <p className="mt-2 text-[12.5px] text-ink-2">Model explanation. Worth reviewing in context.</p>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[14px] font-semibold text-ink">Suggested alternative</h4>
          <CopyButton text={finding.alternative_wording} />
        </div>
        <p className="mt-1.5 rounded-[14px] border border-teal/20 bg-teal-soft/60 px-4 py-3 text-[14.5px] leading-relaxed text-ink">
          <Wording text={finding.alternative_wording} />
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-2">Newly generated wording, not a quotation. Bracketed parts are placeholders.</p>
      </section>

      <section className="mt-6 rounded-[16px] border border-dashed border-ink/20 p-4" aria-label="Your review">
        <h4 className="text-[14px] font-semibold text-ink">Your review</h4>
        <p className="mt-0.5 text-[13px] text-ink-2">Kept separately from the model's finding, in this tab only, and included in the report.</p>
        <Segmented<Verdict>
          label={`Review for ${finding.finding_id}`}
          layoutGroup={`review-${finding.finding_id}`}
          allowEmpty
          value={review.verdict}
          onValueChange={(verdict) => setReview(finding.finding_id, { verdict })}
          options={(Object.keys(VERDICT_LABEL) as Verdict[]).map((value) => ({ value, label: VERDICT_LABEL[value] }))}
          className="mt-3 w-full"
        />
        <label htmlFor={noteId} className="mt-3 block text-[13px] font-semibold text-ink">
          Note <span className="font-normal text-ink-2">(optional)</span>
        </label>
        <textarea
          id={noteId}
          value={review.note}
          maxLength={280}
          rows={2}
          onChange={(e) => setReview(finding.finding_id, { note: e.target.value })}
          placeholder="Why you agree or disagree"
          className="mt-1.5 block w-full resize-y rounded-control border border-ink/12 bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal/20"
        />
        <div className="mt-1.5 flex items-center justify-between text-[12.5px] text-ink-2">
          <span>{review.verdict ? `Marked ${VERDICT_LABEL[review.verdict].toLowerCase()}. Select it again to clear.` : "Not reviewed yet."}</span>
          <span className="tnum">{review.note.length}/280</span>
        </div>
      </section>
    </section>
  );
}

/** Copies the generated wording; the label confirms the copy for a moment. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), 2200);
    return () => window.clearTimeout(id);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <>
      <Button size="sm" variant="ghost" className="-mr-2" onClick={() => void copy()}>
        {state === "copied" ? <IconCheck size={16} stroke={2} className="text-teal" aria-hidden /> : <IconCopy size={16} stroke={1.75} aria-hidden />}
        {state === "copied" ? "Copied" : state === "failed" ? "Copy unavailable" : "Copy wording"}
      </Button>
      <span className="sr-only" role="status">
        {state === "copied" ? "Suggested wording copied" : state === "failed" ? "Copying is not available in this browser" : ""}
      </span>
    </>
  );
}

export { VERDICT_LABEL };
