import { IconAlertCircle, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import type { ParseIssue } from "@/lib/types";

const ORDER = { error: 0, warning: 1, info: 2 } as const;

export function IssueList({ issues }: { issues: ParseIssue[] }) {
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <ul className="space-y-2" aria-label="Parsing notes">
      {sorted.map((issue, i) => {
        const Icon = issue.severity === "error" ? IconAlertCircle : issue.severity === "warning" ? IconAlertTriangle : IconInfoCircle;
        const tone =
          issue.severity === "error"
            ? "border-brick/25 bg-brick-soft/60"
            : issue.severity === "warning"
              ? "border-amber/30 bg-amber-soft/60"
              : "border-ink/8 bg-surface/70";
        const iconTone = issue.severity === "error" ? "text-brick" : issue.severity === "warning" ? "text-amber-ink" : "text-ink-2";
        const label = issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Note";
        return (
          <li key={`${issue.code}-${i}`} className={`flex gap-2.5 rounded-[14px] border px-3 py-2.5 text-[13.5px] leading-snug ${tone}`}>
            <Icon size={18} stroke={1.75} className={`mt-px shrink-0 ${iconTone}`} aria-hidden />
            <span>
              <span className="sr-only">{label}: </span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
