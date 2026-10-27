import { MotionConfig, type Transition } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type MotionPreference = "system" | "reduced" | "full";

interface MotionContextValue {
  preference: MotionPreference;
  setPreference: (value: MotionPreference) => void;
  /** Effective setting after combining the preference with the operating-system setting. */
  reduced: boolean;
}

const MotionContext = createContext<MotionContextValue | null>(null);
const STORAGE_KEY = "prism.motion"; // the only value PRISM keeps in browser storage

function readStoredPreference(): MotionPreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "reduced" || value === "full" ? value : "system";
  } catch {
    return "system";
  }
}

function useSystemReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<MotionPreference>(readStoredPreference);
  const systemReduced = useSystemReducedMotion();
  const reduced = preference === "reduced" || (preference === "system" && systemReduced);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);

  const value = useMemo<MotionContextValue>(
    () => ({
      preference,
      reduced,
      setPreference: (next) => {
        setPreferenceState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* storage unavailable: the setting still applies for this tab */
        }
      },
    }),
    [preference, reduced],
  );

  return (
    <MotionContext.Provider value={value}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>
    </MotionContext.Provider>
  );
}

export function useMotionPreference(): MotionContextValue {
  const context = useContext(MotionContext);
  if (!context) throw new Error("useMotionPreference must be used inside MotionPreferenceProvider");
  return context;
}

// Shared timing. Control feedback 150–250 ms, panels 220–320 ms, entrance 400–600 ms.
export const ease = [0.22, 1, 0.36, 1] as const;
export const durations = { control: 0.2, panel: 0.28, entrance: 0.52 } as const;

export const panelTransition: Transition = { duration: durations.panel, ease };

export function scrollBehavior(reduced: boolean): ScrollBehavior {
  return reduced ? "auto" : "smooth";
}
