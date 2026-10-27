import { SpeakerTag } from "@/components/common/SpeakerTag";
import { Button } from "@/components/ui/button";
import { formatInt, formatShare, pluralize } from "@/lib/format";
import { hasFoldedSpeakers } from "@/lib/speakers";
import { useScrollable } from "@/lib/useElementSize";
import { useResults } from "./context";
import { ParticipationChart } from "./ParticipationChart";
import { TurnRibbon } from "./TurnRibbon";

export function OverviewTab() {
  const { response, colors, setTab, reviews } = useResults();
  const { parse, analysis } = response;
  const agreed = analysis.decisions.filter((d) => d.status === "agreed").length;
  const proposed = analysis.decisions.length - agreed;
  const withoutOwner = analysis.action_items.filter((a) => !a.owner).length;
  const reviewed = analysis.findings.filter((f) => reviews[f.finding_id]?.verdict).length;
  const [tableRef, tableScrolls] = useScrollable<HTMLDivElement>("x");

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section aria-labelledby="participation-heading" className="panel min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id="participation-heading" className="text-[17px] font-bold tracking-[-0.01em]">
              Participation
            </h3>
            <p className="text-[13px] text-ink-2">Words per speaker, in order of first appearance</p>
          </div>
          <div className="mt-4">
            <ParticipationChart speakers={parse.speakers} />
          </div>
          <div
            ref={tableRef}
            className="mt-4 overflow-x-auto rounded-[10px]"
            tabIndex={tableScrolls ? 0 : undefined}
            role={tableScrolls ? "region" : undefined}
            aria-label={tableScrolls ? "Participation table, scrolls sideways" : undefined}
          >
            <table className="w-full border-collapse text-[14px]">
              <caption className="sr-only">Participation per speaker: words, word share and turns</caption>
              <thead>
                <tr className="border-b border-ink/10 text-left text-[12.5px] text-ink-2">
                  <th scope="col" className="py-2 pr-2 font-semibold sm:pr-3">Speaker</th>
                  <th scope="col" className="py-2 pr-2 text-right font-semibold sm:pr-3">Words</th>
                  <th scope="col" className="py-2 pr-2 text-right font-semibold sm:pr-3">
                    <span className="hidden sm:inline">Word share</span>
                    <span className="sm:hidden">Share</span>
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">Turns</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {parse.speakers.map((speaker) => (
                  <tr key={speaker.speaker_id} className="border-b border-ink/6 last:border-0">
                    <th scope="row" className="max-w-[9.5rem] py-2 pr-2 text-left font-normal sm:max-w-none sm:pr-3">
                      <SpeakerTag label={speaker.label} color={colors.get(speaker.speaker_id) ?? "#6b7470"} className="max-w-full" />
                    </th>
                    <td className="py-2 pr-2 text-right sm:pr-3">{formatInt(speaker.words)}</td>
                    <td className="py-2 pr-2 text-right font-semibold sm:pr-3">{formatShare(speaker.word_share)}</td>
                    <td className="py-2 text-right">{formatInt(speaker.turns)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/10 font-semibold">
                  <th scope="row" className="py-2 pr-2 text-left sm:pr-3">Total</th>
                  <td className="py-2 pr-2 text-right sm:pr-3">{formatInt(parse.total_words)}</td>
                  <td className="py-2 pr-2 text-right sm:pr-3">{parse.total_words > 0 ? "100%" : "n/a"}</td>
                  <td className="py-2 text-right">{formatInt(parse.total_turns)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            Word share counts words in the transcript; it is not speaking time, and unequal participation is not treated as a
            concern on its own. Shares are rounded and may not add up to exactly 100%.
            {hasFoldedSpeakers(parse.speakers) && " Speakers after the sixth share a neutral colour."}
          </p>
        </section>

        <section aria-labelledby="glance-heading" className="panel min-w-0 p-5 sm:p-6">
          <h3 id="glance-heading" className="text-[17px] font-bold tracking-[-0.01em]">
            At a glance
          </h3>
          {analysis.discussion_points.length > 0 ? (
            <ul className="mt-3 space-y-2.5">
              {analysis.discussion_points.slice(0, 3).map((point) => (
                <li key={point.item_id} className="border-l-2 border-mint pl-3 text-[14.5px] leading-relaxed text-ink">
                  {point.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[14px] text-ink-2">No discussion points could be verified.</p>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="well p-3">
              <dt className="text-[12.5px] font-medium text-ink-2">Decisions</dt>
              <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">
                {agreed} agreed, {proposed} proposed
              </dd>
            </div>
            <div className="well p-3">
              <dt className="text-[12.5px] font-medium text-ink-2">Action items</dt>
              <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">
                {pluralize(analysis.action_items.length, "item")}
                {withoutOwner > 0 && <span className="block text-[13px] font-medium text-ink-2">{withoutOwner} without an owner</span>}
              </dd>
            </div>
            <div className="well col-span-2 p-3">
              <dt className="text-[12.5px] font-medium text-ink-2">Potential concerns (model findings)</dt>
              <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">
                {analysis.findings.length === 0
                  ? response.findings_returned > 0
                    ? "None verified"
                    : "None identified"
                  : `${pluralize(analysis.findings.length, "finding")}, ${reviewed} reviewed by you`}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTab("language")}>
              Review language
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTab("summary")}>
              Summary and actions
            </Button>
          </div>
        </section>
      </div>

      <TurnRibbon />
    </div>
  );
}
