import { cn } from "@/lib/cn";

/** Speaker identity: a colour swatch beside the name. The name always carries the meaning. */
export function SpeakerTag({ label, color, className, strong = true }: { label: string; color: string; className?: string; strong?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: color }} aria-hidden />
      <span className={cn("truncate", strong ? "font-semibold text-ink" : "text-ink-2")}>{label}</span>
    </span>
  );
}
