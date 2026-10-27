import { splitAtHighlight } from "@/lib/highlight";
import type { Evidence } from "@/lib/types";

interface TurnTextProps {
  text: string;
  evidence?: Evidence | null;
  tone?: "identity" | "personal" | "source";
  animateKey?: number;
  className?: string;
}

/** A turn's message, as plain React text, with at most one verified quotation highlighted. */
export function TurnText({ text, evidence, tone = "source", animateKey, className }: TurnTextProps) {
  if (!text) return <p className={className}><span className="italic text-ink-2">(no message text)</span></p>;
  const segments = evidence ? splitAtHighlight(text, evidence.highlight, evidence.quote) : null;
  if (!segments) return <p className={className}>{text}</p>;
  return (
    <p className={className}>
      {segments.before}
      <mark key={animateKey} className="evidence-mark" data-tone={tone} data-animate="true">
        {segments.match}
      </mark>
      {segments.after}
    </p>
  );
}
