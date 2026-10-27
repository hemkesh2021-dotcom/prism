import { useLayoutEffect, useState } from "react";

/**
 * Width of an element, kept current with a ResizeObserver (0 until measured).
 * Returns a callback ref, so elements that mount later (portals, dialogs) are observed too.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

/**
 * Whether an element currently scrolls. Scrollable regions without focusable content
 * need tabIndex=0 so keyboard users can scroll them; regions that fit get no extra tab stop.
 */
export function useScrollable<T extends HTMLElement>(axis: "x" | "y" = "y") {
  const [element, setElement] = useState<T | null>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    const check = () =>
      setScrollable(axis === "x" ? element.scrollWidth > element.clientWidth + 1 : element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [element, axis]);
  return [setElement, scrollable] as const;
}
