import { animate } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { formatInt } from "@/lib/format";
import { ease, useMotionPreference } from "@/lib/motion";

/**
 * An exact integer that counts up once when it first appears (a calm arrival cue for
 * results). Screen readers and reduced motion get the final value immediately.
 */
export function CountUp({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const { reduced } = useMotionPreference();
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || reduced || value === 0) return;
    // Update React's own text node in place, so later renders stay in sync with the DOM.
    const write = (n: number) => {
      if (element.firstChild) element.firstChild.nodeValue = formatInt(n);
    };
    write(0);
    const controls = animate(0, value, {
      duration: 0.65,
      delay,
      ease,
      onUpdate: (latest) => write(Math.round(latest)),
      onComplete: () => write(value),
    });
    return () => {
      controls.stop();
      write(value);
    };
  }, [value, reduced, delay]);

  // One element only: a hidden duplicate for screen readers would be copied twice when the page text is
  // selected. The count-up lasts 0.65 s, so a reader landing mid-animation sees the final value a moment later.
  return (
    <span ref={ref} className={className}>
      {formatInt(value)}
    </span>
  );
}
