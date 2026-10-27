import { IconChevronLeft, IconChevronRight, IconList, IconListDetails } from "@tabler/icons-react";
import { useId, useState } from "react";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useResults } from "./context";

/**
 * Turn sequence ribbon: one equal-width segment per parsed turn, coloured by speaker.
 * It shows order, not time. A single range control drives selection (arrow keys,
 * drag or tap anywhere), so many turns never become tiny targets; a full list is
 * available as an accessible alternative.
 */
export function TurnRibbon() {
  const { turns, colors, response, showInTranscript } = useResults();
  const [index, setIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const labelId = useId();
  const count = turns.length;
  const turn = turns[Math.min(index, count - 1)];
  const gap = count <= 80 ? 2 : 0;

  if (!turn) return null;
  const select = (next: number) => setIndex(Math.max(0, Math.min(count - 1, next)));

  return (
    <section aria-labelledby={labelId} className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={labelId} className="text-[17px] font-bold tracking-[-0.01em]">
          Turn sequence
        </h3>
        <p className="text-[13px] text-ink-2">Turn order, not a time scale. Each segment is one turn.</p>
      </div>

      <div className="relative mt-4">
        <div className="flex h-12 overflow-hidden rounded-[12px] bg-porcelain-deep p-1 shadow-inset" style={{ gap }} aria-hidden>
          {turns.map((t, i) => (
            <div
              key={t.turn_id}
              className={cn("min-w-0 flex-1 rounded-[3px] transition-opacity duration-200", i === index ? "opacity-100" : "opacity-80")}
              style={{ backgroundColor: colors.get(t.speaker_id) }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={index}
          onChange={(e) => select(Number(e.target.value))}
          aria-label="Selected turn"
          aria-valuetext={`Turn ${index + 1} of ${count}, ${turn.speaker_label}`}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        />
        <div
          className="pointer-events-none absolute -bottom-1 -top-1 rounded-[6px] border-2 border-ink bg-white/10 shadow-control transition-[left] duration-150 ease-out-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal"
          style={{ left: `calc(4px + (100% - 8px) * ${index / count})`, width: `max(8px, calc((100% - 8px) / ${count}))` }}
          aria-hidden
        />
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" aria-label="Speaker colours">
        {response.parse.speakers.map((speaker) => (
          <li key={speaker.speaker_id}>
            <SpeakerTag label={speaker.label} color={colors.get(speaker.speaker_id) ?? "#6b7470"} strong={false} />
          </li>
        ))}
      </ul>

      <div className="well mt-4 p-4" aria-live="polite">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="turn-id">{turn.turn_id}</span>
          <SpeakerTag label={turn.speaker_label} color={colors.get(turn.speaker_id) ?? "#6b7470"} />
          <span className="tnum text-[13px] text-ink-2">
            Turn {index + 1} of {count}
          </span>
          <div className="ml-auto flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => select(index - 1)} disabled={index === 0} aria-label="Previous turn">
              <IconChevronLeft size={20} stroke={2} aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => select(index + 1)} disabled={index === count - 1} aria-label="Next turn">
              <IconChevronRight size={20} stroke={2} aria-hidden />
            </Button>
          </div>
        </div>
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-ink">
          {turn.text || <span className="italic text-ink-2">(no message text)</span>}
        </p>
        <Button size="sm" variant="quiet" className="-ml-3 mt-1" onClick={() => showInTranscript(turn.turn_id, null, "turn")}>
          <IconListDetails size={16} stroke={1.75} aria-hidden />
          Open in transcript
        </Button>
      </div>

      <Button size="sm" variant="ghost" className="-ml-3 mt-3" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
        <IconList size={16} stroke={1.75} aria-hidden />
        {listOpen ? "Hide turn list" : "Show turn list"}
      </Button>
      {listOpen && (
        <ol className="mt-2 max-h-[320px] space-y-1 overflow-y-auto rounded-[14px] border border-ink/8 bg-surface/70 p-1.5" aria-label="All turns in order">
          {turns.map((t, i) => (
            <li key={t.turn_id}>
              <button
                type="button"
                onClick={() => select(i)}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-[13.5px] transition-colors",
                  i === index ? "bg-teal-soft" : "hover:bg-porcelain-deep",
                )}
              >
                <span className="turn-id w-9 shrink-0">{t.turn_id}</span>
                <SpeakerTag label={t.speaker_label} color={colors.get(t.speaker_id) ?? "#6b7470"} className="w-28 shrink-0" />
                <span className="truncate text-ink-2">{t.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
