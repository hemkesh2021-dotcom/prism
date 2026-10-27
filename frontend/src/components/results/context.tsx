import { createContext, useContext } from "react";
import type { AnalyzeResponse, Evidence, Finding, Turn } from "@/lib/types";
import type { Review, Verdict } from "@/state/workspace";

export type ResultsTab = "overview" | "language" | "summary";

export interface ActiveHighlight {
  turnId: string;
  evidence: Evidence | null;
  tone: "identity" | "personal" | "source" | "turn";
  /** Changes on every request so the highlight sweep replays. */
  nonce: number;
  /** Scroll the transcript to the turn (desktop selection, or an explicit "view in context"). */
  scroll: boolean;
  /** Move keyboard focus to the turn (explicit navigation only). */
  focus: boolean;
}

export interface ResultsContextValue {
  response: AnalyzeResponse;
  turns: Turn[];
  turnIndex: Map<string, number>;
  colors: Map<string, string>;
  findingsById: Map<string, Finding>;
  reviews: Record<string, Review>;
  setReview: (findingId: string, change: { verdict?: Verdict | null; note?: string }) => void;
  tab: ResultsTab;
  setTab: (tab: ResultsTab) => void;
  selectedFindingId: string | null;
  selectFinding: (findingId: string | null) => void;
  highlight: ActiveHighlight | null;
  /** Switch to Language review and bring a turn (and optional quotation) into view. */
  showInTranscript: (turnId: string, evidence?: Evidence | null, tone?: ActiveHighlight["tone"]) => void;
  openSource: (evidence: Evidence) => void;
}

export const ResultsContext = createContext<ResultsContextValue | null>(null);

export function useResults(): ResultsContextValue {
  const value = useContext(ResultsContext);
  if (!value) throw new Error("useResults must be used inside ResultsContext");
  return value;
}

export const findingTone = (finding: Finding): "identity" | "personal" =>
  finding.category === "personal_attack" ? "personal" : "identity";
