// Mirrors backend/prism/schemas.py. Keep the two in sync.

export type Mode = "live" | "demo";
export type FindingCategory = "identity_stereotyping" | "identity_dismissal" | "personal_attack";
export type IdentityCharacteristic =
  | "age"
  | "gender"
  | "race_or_ethnicity"
  | "nationality_or_origin"
  | "religion"
  | "caste"
  | "disability"
  | "sexual_orientation"
  | "other";
export type DecisionStatus = "agreed" | "proposed";
export type ActionStatus = "committed" | "suggested";
export type SuggestionBasis = "evidence" | "general";
export type Section = "findings" | "discussion_points" | "decisions" | "action_items" | "suggestions";

export interface ParseIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  lines: number[];
}

export interface Turn {
  turn_id: string;
  index: number;
  speaker_id: string;
  speaker_label: string;
  text: string;
  word_count: number;
  line_start: number;
  line_end: number;
}

export interface SpeakerStats {
  speaker_id: string;
  label: string;
  order: number;
  words: number;
  turns: number;
  /** Fraction 0–1, unrounded; null when the transcript has no words. */
  word_share: number | null;
}

export interface ParseResult {
  ok: boolean;
  grammar_version: string;
  transcript_hash: string;
  char_count: number;
  line_count: number;
  total_words: number;
  total_turns: number;
  speakers: SpeakerStats[];
  turns: Turn[];
  issues: ParseIssue[];
}

/** UTF-16 code-unit offsets into Turn.text (JavaScript string indices). */
export interface Highlight {
  start: number;
  end: number;
  occurrences: number;
}

export interface Evidence {
  turn_id: string;
  speaker_id: string;
  speaker_label: string;
  quote: string;
  highlight: Highlight;
}

export interface Finding {
  finding_id: string;
  category: FindingCategory;
  identity_characteristic: IdentityCharacteristic | null;
  evidence: Evidence;
  explanation: string;
  context_note: string | null;
  alternative_wording: string;
}

export interface DiscussionPoint {
  item_id: string;
  text: string;
  sources: Evidence[];
}

export interface Decision {
  item_id: string;
  text: string;
  status: DecisionStatus;
  sources: Evidence[];
}

export interface ActionItem {
  item_id: string;
  task: string;
  owner: string | null;
  deadline: string | null;
  status: ActionStatus;
  sources: Evidence[];
}

export interface Suggestion {
  item_id: string;
  text: string;
  basis: SuggestionBasis;
  related_finding_id: string | null;
  sources: Evidence[];
}

export interface AnalysisContent {
  findings: Finding[];
  discussion_points: DiscussionPoint[];
  decisions: Decision[];
  action_items: ActionItem[];
  suggestions: Suggestion[];
}

export interface ValidationNotice {
  section: Section;
  code: string;
  count: number;
  message: string;
}

export interface AnalyzeResponse {
  analysis_id: string;
  mode: Mode;
  sample_id: string | null;
  model: string | null;
  prompt_version: string;
  generated_at: string;
  transcript_hash: string;
  attempts: number;
  findings_returned: number;
  parse: ParseResult;
  analysis: AnalysisContent;
  notices: ValidationNotice[];
}

export interface HealthResponse {
  status: "ok";
  app_version: string;
  prompt_version: string;
  grammar_version: string;
  live: { available: boolean; model: string | null; effort: string | null; missing: string[] };
  limits: { max_transcript_chars: number; max_upload_bytes: number };
  request_timeout_seconds: number;
}

export interface SampleInfo {
  sample_id: string;
  title: string;
  description: string;
  transcript: string;
  demo_available: boolean;
}

export interface AppError {
  code: string;
  message: string;
  status?: number;
  retryAfterSeconds?: number | null;
}
