import type { Highlight } from "./types";

export interface TextSegments {
  before: string;
  match: string;
  after: string;
}

/**
 * Split a turn's text around a verified quotation.
 *
 * Offsets from the API are UTF-16 code units, the same unit as JavaScript string
 * indices, so `slice` is exact even with emoji. As a guard, the slice must equal the
 * quotation; otherwise we fall back to an exact `indexOf` (first occurrence), and if
 * that fails too we return null and show the turn without a highlight.
 */
export function splitAtHighlight(text: string, highlight: Highlight, quote: string): TextSegments | null {
  const { start, end } = highlight;
  if (start >= 0 && end <= text.length && start < end && text.slice(start, end) === quote) {
    return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
  }
  const index = text.indexOf(quote);
  if (quote && index >= 0) {
    return { before: text.slice(0, index), match: quote, after: text.slice(index + quote.length) };
  }
  return null;
}

export interface WordingToken {
  kind: "text" | "placeholder";
  value: string;
}

/** Split generated alternative wording so [bracketed placeholders] stay visible. */
export function tokenizePlaceholders(text: string): WordingToken[] {
  const tokens: WordingToken[] = [];
  const pattern = /\[[^\]\n]{1,80}\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", value: text.slice(last, index) });
    tokens.push({ kind: "placeholder", value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}
