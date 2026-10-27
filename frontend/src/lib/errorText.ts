import type { AppError } from "./types";

const TITLES: Record<string, string> = {
  backend_unavailable: "Can't reach the PRISM backend",
  live_not_configured: "Live analysis isn't set up",
  timeout: "The model took too long to respond",
  client_timeout: "The analysis took too long",
  rate_limited: "The AI provider is rate-limiting requests",
  malformed_output: "The model's response couldn't be used",
  output_truncated: "The model's response was cut off",
  model_refusal: "The model declined this transcript",
  provider_auth: "The provider rejected the API key",
  model_not_found: "The configured model wasn't found",
  provider_rejected_request: "The provider rejected the request",
  provider_unreachable: "The backend couldn't reach the AI provider",
  provider_unavailable: "The AI provider is temporarily unavailable",
  parse_failed: "Fix the transcript format first",
  transcript_empty: "There's no transcript yet",
  transcript_too_long: "The transcript is over the limit",
  transcript_too_large: "The transcript is over the size limit",
  unsupported_encoding: "The text can't be read",
  demo_requires_unedited_sample: "Demo results need the unedited sample",
  demo_unavailable: "Demo results aren't available here",
  demo_fixture_mismatch: "The demo files are out of sync",
};

/** Short headline for an error code. */
export function errorTitle(error: AppError): string {
  return TITLES[error.code] ?? "Something went wrong";
}

/** The message without a first sentence that only repeats the title. */
export function errorDetail(error: AppError): string {
  const title = errorTitle(error).toLowerCase();
  const match = error.message.match(/^(.+?[.!?])\s+(.+)$/s);
  if (match && match[1].replace(/[.!?]$/, "").trim().toLowerCase() === title) return match[2];
  return error.message;
}
