import { IconBulb, IconCalendarDue, IconUser } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Wording } from "@/components/common/Wording";
import { cn } from "@/lib/cn";
import { ACTION_LABEL, DECISION_LABEL, NOT_SPECIFIED, findingTitle } from "@/lib/format";
import type { ActionItem, Decision } from "@/lib/types";
import { useResults } from "./context";
import { SourceList } from "./SourceDialog";

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={id} className="text-[17px] font-bold tracking-[-0.01em]">
          {title}
        </h3>
        {hint && <p className="text-[13px] text-ink-2">{hint}</p>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-[14px] text-ink-2">{children}</p>;

function StatusPill({ tone, children }: { tone: "firm" | "open"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold",
        tone === "firm" ? "bg-teal-soft text-teal-strong" : "border border-dashed border-ink/25 text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

export function SummaryTab() {
  const { response, findingsById } = useResults();
  const { discussion_points, decisions, action_items, suggestions } = response.analysis;
  const agreed = decisions.filter((d) => d.status === "agreed");
  const proposed = decisions.filter((d) => d.status === "proposed");
  const committed = action_items.filter((a) => a.status === "committed");
  const suggestedActions = action_items.filter((a) => a.status === "suggested");

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Block id="discussion-heading" title="Discussion points" hint="Model summary with verified sources">
          {discussion_points.length === 0 ? (
            <Empty>No discussion points could be verified.</Empty>
          ) : (
            <ul className="space-y-4">
              {discussion_points.map((point) => (
                <li key={point.item_id} className="border-l-2 border-mint pl-4">
                  <p className="text-[15px] leading-relaxed text-ink">{point.text}</p>
                  <SourceList sources={point.sources} className="mt-2" />
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block id="decisions-heading" title="Decisions" hint="Agreed decisions are kept apart from proposals">
          {decisions.length === 0 ? (
            <Empty>No decisions were identified.</Empty>
          ) : (
            <div className="space-y-5">
              <DecisionGroup title={DECISION_LABEL.agreed} decisions={agreed} empty="Nothing was clearly agreed." />
              <DecisionGroup title="Proposed, not agreed" decisions={proposed} empty="No open proposals." />
            </div>
          )}
        </Block>
      </div>

      <div className="min-w-0 space-y-6">
        <Block id="actions-heading" title="Action items" hint="Owners and deadlines only as stated">
          {action_items.length === 0 ? (
            <Empty>No action items were identified.</Empty>
          ) : (
            <div className="space-y-5">
              <ActionGroup title={ACTION_LABEL.committed} items={committed} />
              <ActionGroup title="Suggested, not accepted" items={suggestedActions} />
            </div>
          )}
        </Block>

        <Block id="suggestions-heading" title="Suggestions" hint="Generated advice for future meetings">
          {suggestions.length === 0 ? (
            <Empty>No suggestions.</Empty>
          ) : (
            <ul className="space-y-4">
              {suggestions.map((suggestion) => {
                const related = suggestion.related_finding_id ? findingsById.get(suggestion.related_finding_id) : null;
                return (
                  <li key={suggestion.item_id} className="flex gap-3">
                    <IconBulb size={20} stroke={1.75} className="mt-0.5 shrink-0 text-teal" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[15px] leading-relaxed text-ink">
                        <Wording text={suggestion.text} />
                      </p>
                      <p className="mt-1 text-[12.5px] text-ink-2">
                        {suggestion.basis === "general"
                          ? "General guidance, not tied to a specific turn."
                          : related
                            ? `Related to ${related.finding_id}: ${findingTitle(related)}.`
                            : "Based on the cited turns."}
                      </p>
                      <SourceList sources={suggestion.sources} className="mt-2" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}

function DecisionGroup({ title, decisions, empty }: { title: string; decisions: Decision[]; empty: string }) {
  const firm = title === DECISION_LABEL.agreed;
  return (
    <div>
      <h4>
        <StatusPill tone={firm ? "firm" : "open"}>{title}</StatusPill>
      </h4>
      {decisions.length === 0 ? (
        <p className="mt-1.5 text-[14px] text-ink-2">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {decisions.map((decision) => (
            <li key={decision.item_id} className="rounded-[14px] border border-ink/8 bg-surface/70 p-3.5">
              <p className="text-[15px] leading-relaxed text-ink">{decision.text}</p>
              <SourceList sources={decision.sources} className="mt-2" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionGroup({ title, items }: { title: string; items: ActionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4>
        <StatusPill tone={items[0].status === "committed" ? "firm" : "open"}>{title}</StatusPill>
      </h4>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li key={item.item_id} className="rounded-[14px] border border-ink/8 bg-surface/70 p-3.5">
            <p className="text-[15px] font-medium leading-relaxed text-ink">{item.task}</p>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <IconUser size={15} stroke={1.75} aria-hidden />
                  Owner
                </dt>
                <dd className={cn(item.owner ? "font-semibold text-ink" : "italic text-ink-2")}>{item.owner ?? NOT_SPECIFIED}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <IconCalendarDue size={15} stroke={1.75} aria-hidden />
                  Deadline
                </dt>
                <dd className={cn(item.deadline ? "font-semibold text-ink" : "italic text-ink-2")}>{item.deadline ?? NOT_SPECIFIED}</dd>
              </div>
            </dl>
            <SourceList sources={item.sources} className="mt-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
