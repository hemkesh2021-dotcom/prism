import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Designed SVG version of the Conversation Lens, used when WebGL is unavailable or
 * lost, when motion is reduced, and on small screens. Purely decorative.
 *
 * Each ring is its own <svg> layer rotated with a CSS transform, so the drift runs
 * on the compositor instead of repainting the drawing every frame.
 */
export function LensFallback({ paused = false, focus = false, className }: { paused?: boolean; focus?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const layer = "absolute inset-0 h-full w-full overflow-visible";
  const tilt = (degrees: number) => ({ transform: `rotate(${degrees}deg)`, transformOrigin: "160px 160px", transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)" });
  return (
    <div className={cn("lens-fallback relative h-full w-full overflow-hidden", className)} data-paused={paused ? "true" : "false"} aria-hidden>
      <svg viewBox="0 0 320 320" className={layer} focusable="false">
        <defs>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#E9FFF7" stopOpacity="1" />
            <stop offset="0.35" stopColor="#B9E6D6" stopOpacity="0.75" />
            <stop offset="1" stopColor="#B9E6D6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-core`} cx="42%" cy="38%" r="65%">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#7FD6BC" />
          </radialGradient>
          <radialGradient id={`${id}-shadow`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#4C422E" stopOpacity="0.16" />
            <stop offset="1" stopColor="#4C422E" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-bandA`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#B9E6D6" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#8ED3BD" stopOpacity="0.85" />
            <stop offset="1" stopColor="#B9E6D6" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id={`${id}-bandB`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#176D63" stopOpacity="0.08" />
            <stop offset="0.55" stopColor="#2F8F80" stopOpacity="0.55" />
            <stop offset="1" stopColor="#176D63" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id={`${id}-bandC`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#DDEFE8" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="#C4E8DB" stopOpacity="0.9" />
            <stop offset="1" stopColor="#DDEFE8" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2B3532" stopOpacity="0" />
            <stop offset="0.3" stopColor="#2B3532" stopOpacity="0.6" />
            <stop offset="0.75" stopColor="#2B3532" stopOpacity="0.55" />
            <stop offset="1" stopColor="#2B3532" stopOpacity="0" />
          </linearGradient>
        </defs>
        <ellipse cx="160" cy="292" rx="96" ry="12" fill={`url(#${id}-shadow)`} />
        <circle cx="160" cy="160" r={focus ? 84 : 72} fill={`url(#${id}-glow)`} style={{ transition: "r 600ms ease" }} />
      </svg>

      <svg viewBox="0 0 320 320" className={cn(layer, "lens-fallback-ring")} focusable="false">
        <g style={tilt(focus ? -8 : -20)}>
          <ellipse cx="160" cy="160" rx="124" ry="44" stroke={`url(#${id}-bandA)`} strokeWidth="11" fill="none" strokeDasharray="520 120" strokeLinecap="round" />
          <ellipse cx="160" cy="160" rx="130" ry="49" stroke={`url(#${id}-rim)`} strokeWidth="1.3" fill="none" strokeDasharray="300 160" />
        </g>
      </svg>
      <svg viewBox="0 0 320 320" className={cn(layer, "lens-fallback-ring reverse")} focusable="false">
        <g style={tilt(focus ? 4 : 32)}>
          <ellipse cx="160" cy="160" rx="98" ry="78" stroke={`url(#${id}-bandB)`} strokeWidth="8" fill="none" strokeDasharray="410 90" strokeLinecap="round" />
          <ellipse cx="160" cy="160" rx="103" ry="83" stroke={`url(#${id}-rim)`} strokeWidth="1.1" fill="none" strokeDasharray="160 60 220 80" />
        </g>
      </svg>
      <svg viewBox="0 0 320 320" className={cn(layer, "lens-fallback-ring slow")} focusable="false">
        <g style={tilt(focus ? 12 : 68)}>
          <ellipse cx="160" cy="160" rx="142" ry="24" stroke={`url(#${id}-bandC)`} strokeWidth="7" fill="none" strokeDasharray="600 140" strokeLinecap="round" />
        </g>
      </svg>

      <svg viewBox="0 0 320 320" className={layer} focusable="false">
        <circle cx="160" cy="160" r="24" fill="none" stroke="#2B3532" strokeOpacity="0.35" strokeWidth="1" />
        <circle cx="160" cy="160" r="13" fill={`url(#${id}-core)`} />
      </svg>
    </div>
  );
}
