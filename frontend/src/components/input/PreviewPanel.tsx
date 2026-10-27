import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { ErrorCallout } from "@/components/common/ErrorCallout";
import { IssueList } from "@/components/common/IssueList";
import { SpeakerTag } from "@/components/common/SpeakerTag";
import { Button } from "@/components/ui/button";
import { formatInt, formatShare } from "@/lib/format";
import { panelTransition } from "@/lib/motion";
import { hasFoldedSpeakers, speakerColor } from "@/lib/speakers";
import { FORMAT_EXAMPLE } from "@/lib/transcript";
import type { ParseResult } from "@/lib/types";
import type { PreviewState } from "@/state/workspace";

interface PreviewPanelProps {
  preview: PreviewState;
  version: number;
  hasText: boolean;
  onPreview: () => void;
}

export function PreviewPanel({ preview, version, hasText, onPreview }: PreviewPanelProps) {
  const stale = preview.status !== "idle" && preview.version !== version;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="preview-heading" aria-busy={preview.status === "loading"}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="preview-heading" className="text-[17px] font-bold tracking-[-0.01em]">
          {preview.status === "idle" ? "How PRISM reads a transcript" : "Preview"}
        </h2>
        {stale && hasText && (
          <Button size="sm" variant="secondary" onClick={onPreview}>
            <IconRefresh size={16} stroke={2} aria-hidden />
            Preview again
          </Button>
        )}
      </div>
      {stale && hasText && (
        <p className="mt-1 text-[13px] text-amber-ink">The transcript changed after this preview, so these numbers may be out of date.</p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={preview.status === "ready" ? `ready-${preview.result.transcript_hash}` : preview.status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={panelTransition}
          className="mt-4"
        >
          {preview.status === "idle" && <FormatGuide />}
          {preview.status === "loading" && (
            <p className="flex items-center gap-2 text-[14px] text-ink-2" role="status">
              <IconLoader2 size={18} className="motion-safe:animate-spin" aria-hidden />
              Reading the transcript…
            </p>
          )}
          {preview.status === "error" && <ErrorCallout error={preview.error} />}
          {preview.status === "ready" && <PreviewResult result={preview.result} />}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function FormatGuide() {
  return (
    <div className="space-y-4 text-[14px] leading-relaxed text-ink-2">
      <ul className="space-y-2">
        <li>
          Start each turn with a speaker label, a colon and a space: <span className="font-semibold text-ink">Speaker: Message</span>.
        </li>
        <li>A line without a label continues the previous turn.</li>
        <li>Only the first colon separates the speaker; later colons stay in the message.</li>
        <li>Timestamps such as “[10:02]” are not supported in this version.</li>
      </ul>
      <figure>
        <figcaption className="mb-1.5 text-[13px] font-semibold text-ink">Example</figcaption>
        <pre className="well overflow-x-auto whitespace-pre-wrap px-4 py-3 font-sans text-[13.5px] leading-relaxed text-ink">{FORMAT_EXAMPLE}</pre>
      </figure>
      <p className="text-[13px]">Preview checks the format and counts words on PRISM's own server. Nothing is sent to an AI provider until you analyze in live mode.</p>
    </div>
  );
}

function PreviewResult({ result }: { result: ParseResult }) {
  const folded = hasFoldedSpeakers(result.speakers);
  return (
    <div className="space-y-5">
      <dl className="well grid grid-cols-3 divide-x divide-ink/8 py-3 text-center">
        {[
          ["Speakers", result.speakers.length],
          ["Turns", result.total_turns],
          ["Words", result.total_words],
        ].map(([label, value]) => (
          <div key={label as string} className="px-2">
            <dt className="text-[12.5px] font-medium text-ink-2">{label}</dt>
            <dd className="tnum text-[22px] font-bold tracking-[-0.02em] text-ink">{formatInt(value as number)}</dd>
          </div>
        ))}
      </dl>

      <IssueList issues={result.issues} />

      {result.speakers.length > 0 && (
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">Participation by word share</h3>
          <ul className="mt-3 space-y-3" aria-label="Word share per speaker, in order of first appearance">
            {result.speakers.map((speaker) => (
              <li key={speaker.speaker_id}>
                <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                  <SpeakerTag label={speaker.label} color={speakerColor(speaker.order)} />
                  <span className="tnum shrink-0 font-semibold">{formatShare(speaker.word_share)}</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-porcelain-deep" aria-hidden>
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out-soft"
                    style={{ width: `${(speaker.word_share ?? 0) * 100}%`, backgroundColor: speakerColor(speaker.order) }}
                  />
                </div>
                <p className="tnum mt-1 text-[12.5px] text-ink-2">
                  {formatInt(speaker.words)} {speaker.words === 1 ? "word" : "words"}, {formatInt(speaker.turns)}{" "}
                  {speaker.turns === 1 ? "turn" : "turns"}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-2">
            Word share counts words, not speaking time.
            {folded && " Speakers after the sixth share a neutral colour; names identify them."}
          </p>
        </div>
      )}
    </div>
  );
}
