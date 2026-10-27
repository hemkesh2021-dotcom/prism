import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("never sends a request whose signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(api.analyze({ transcript: "A: hi", mode: "live", analysis_id: "abcdefgh" }, { signal: controller.signal })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps server errors to their codes and keeps retry-after", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "rate_limited", message: "Slow down", retry_after_seconds: 12 } }, 429)));
    const error = await api.parse("A: hi").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 12 });
  });

  it("treats non-JSON answers and network failures as an unavailable backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    await expect(api.health()).rejects.toMatchObject({ code: "backend_unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.health()).rejects.toMatchObject({ code: "backend_unavailable" });
  });

  it("reports a client timeout when the server does not answer in time", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    const pending = api.analyze({ transcript: "A: hi", mode: "demo", analysis_id: "abcdefgh" }, { timeoutMs: 1000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ code: "client_timeout" });
    vi.useRealTimers();
  });
});
