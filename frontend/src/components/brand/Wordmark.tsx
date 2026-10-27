import { useId } from "react";
import { cn } from "@/lib/cn";

/** Geometric mark: a prism that takes one beam in and lets three perspectives out. */
export function PrismGlyph({ size = 30, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="6" y1="6" x2="22" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D6EFE6" />
        </linearGradient>
      </defs>
      <path d="M1 18.2 L10.4 16.1" stroke="#182422" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18.6 14.6 L31 9.6" stroke="#176D63" strokeWidth="2" strokeLinecap="round" />
      <path d="M19.2 16.4 L31 16.4" stroke="#58B497" strokeWidth="2" strokeLinecap="round" />
      <path d="M18.6 18.2 L31 23.2" stroke="#596662" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M14.2 4.6 L24.6 25.4 H3.8 Z"
        fill={`url(#${id}-face)`}
        stroke="#182422"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.2 4.6 L12.6 25.4" stroke="#182422" strokeOpacity="0.28" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className, showSubtitle = true }: { className?: string; showSubtitle?: boolean }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <PrismGlyph />
      <span className="text-[17px] font-[780] tracking-[0.16em] text-ink">PRISM</span>
      {showSubtitle && (
        <span className="hidden border-l border-ink/15 pl-3 text-[13px] font-medium leading-tight text-ink-2 md:inline">
          Meeting Communication &amp; Bias Analyzer
        </span>
      )}
    </span>
  );
}
