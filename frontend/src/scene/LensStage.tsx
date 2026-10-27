import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { useMotionPreference } from "@/lib/motion";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { LensFallback } from "./LensFallback";
import { supportsWebGL, webglForced } from "./webgl";

const ConversationLens = lazy(() => import("./ConversationLens"));

// The pause choice is shared by every lens on the page and kept in memory only.
let pausedValue = false;
const listeners = new Set<() => void>();
const pausedStore = {
  get: () => pausedValue,
  set: (value: boolean) => {
    pausedValue = value;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const usePaused = () => useSyncExternalStore(pausedStore.subscribe, pausedStore.get, pausedStore.get);

let webglSupport: boolean | null = null;

interface LensStageProps {
  /**
   * panel: the lens beside the input on desktop (it shrinks, as the same scene, while an analysis runs).
   * hero: next to the headline on tablets; a still emblem on phones.
   */
  variant: "panel" | "hero";
  /** Rings align ("come into focus") while analysis runs. Decorative only. */
  focus?: boolean;
  /** Show the built-in pause button (off when the caller places its own LensPlayToggle). */
  control?: boolean;
  className?: string;
}

/**
 * Chooses between the 3D Conversation Lens and its SVG fallback. The 3D code is
 * loaded lazily, and never on small screens, under reduced motion, or without WebGL.
 */
export function LensStage({ variant, focus = false, control = true, className }: LensStageProps) {
  const { reduced } = useMotionPreference();
  const smallScreen = useMediaQuery("(max-width: 767px)");
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const [unavailable, setUnavailable] = useState(false);
  const paused = usePaused();
  const [webgl] = useState(() => (webglSupport ??= supportsWebGL()));

  const still = reduced || (variant === "hero" && smallScreen);
  const use3D = webgl && !unavailable && !still && !smallScreen;

  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0">
        {use3D ? (
          <Suspense fallback={<LensFallback paused focus={focus} />}>
            <ConversationLens
              paused={paused}
              focus={focus}
              parallax={finePointer && variant === "panel"}
              onUnavailable={() => setUnavailable(true)}
              disableWatchdog={webglForced()}
            />
          </Suspense>
        ) : (
          <LensFallback paused={still || paused} focus={focus} />
        )}
      </div>
      {control && !still && (
        <LensPlayToggle
          className={variant === "panel" ? "bottom-3 right-3 h-11 w-11" : "-bottom-1 -right-1 h-9 w-9 after:absolute after:-inset-1 after:content-['']"}
        />
      )}
    </div>
  );
}

/** Pause or play the decorative lens animation (shared by every lens on the page). */
export function LensPlayToggle({ className }: { className?: string }) {
  const paused = usePaused();
  return (
    <button
      type="button"
      onClick={() => pausedStore.set(!paused)}
      aria-pressed={paused}
      aria-label={paused ? "Play lens animation" : "Pause lens animation"}
      className={cn(
        "press absolute inline-flex items-center justify-center rounded-full border border-ink/10 bg-surface/90 text-ink-2 shadow-control backdrop-blur-sm transition-[color,box-shadow] duration-200 hover:text-ink hover:shadow-raised",
        className,
      )}
    >
      {paused ? <IconPlayerPlayFilled size={15} aria-hidden /> : <IconPlayerPauseFilled size={15} aria-hidden />}
    </button>
  );
}
