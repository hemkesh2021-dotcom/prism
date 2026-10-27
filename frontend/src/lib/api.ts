import type { AnalyzeResponse, AppError, HealthResponse, Mode, ParseResult, SampleInfo } from "./types";

export class ApiError extends Error implements AppError {
  code: string;
  status?: number;
  retryAfterSeconds?: number | null;

  constructor(error: AppError) {
    super(error.message);
    this.code = error.code;
    this.status = error.status;
    this.retryAfterSeconds = error.retryAfterSeconds ?? null;
  }
}

export const BACKEND_UNAVAILABLE: AppError = {
  code: "backend_unavailable",
  message:
    "PRISM's backend is not responding. Start it from the backend folder with “uvicorn prism.main:app --port 8000”, then try again.",
};

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(path: string, init: RequestInit, { signal, timeoutMs }: RequestOptions = {}): Promise<T> {
  // A request that was cancelled before it started is never sent (no accidental paid calls).
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;

  try {
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(path, { ...init, signal: controller.signal });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        // A dev proxy answers with plain text when the backend is down.
        throw new ApiError({ ...BACKEND_UNAVAILABLE, status: response.status });
      }
      body = await response.json(); // still covered by the abort signal and the timeout
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      if (timedOut) {
        throw new ApiError({
          code: "client_timeout",
          message: "No response arrived within the time limit. The request was stopped; your transcript is unchanged.",
        });
      }
      if (signal?.aborted) throw cause; // cancelled by the user or superseded: callers ignore it
      throw new ApiError(BACKEND_UNAVAILABLE);
    }

    if (!response.ok) {
      const error = (body as { error?: { code?: unknown; message?: unknown; retry_after_seconds?: unknown } } | null)?.error;
      throw new ApiError({
        code: typeof error?.code === "string" ? error.code : "unexpected_response",
        message: typeof error?.message === "string" ? error.message : `The server answered with HTTP ${response.status}.`,
        status: response.status,
        retryAfterSeconds: typeof error?.retry_after_seconds === "number" ? error.retry_after_seconds : null,
      });
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: (options?: RequestOptions) => request<HealthResponse>("/api/health", { method: "GET" }, { timeoutMs: 8000, ...options }),
  samples: (options?: RequestOptions) => request<SampleInfo[]>("/api/samples", { method: "GET" }, { timeoutMs: 8000, ...options }),
  parse: (transcript: string, options?: RequestOptions) =>
    request<ParseResult>("/api/parse", json({ transcript }), { timeoutMs: 15000, ...options }),
  analyze: (
    body: { transcript: string; mode: Mode; analysis_id: string; sample_id?: string | null },
    options?: RequestOptions,
  ) => request<AnalyzeResponse>("/api/analyze", json(body), options),
};

export function toAppError(error: unknown): AppError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, status: error.status, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { code: "unexpected_error", message: "Something unexpected happened in the browser. Your transcript is unchanged." };
}
