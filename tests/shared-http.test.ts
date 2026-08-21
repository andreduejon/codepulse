import { afterEach, describe, expect, mock, test } from "bun:test";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";
import { fetchWithRetry, isAbortError } from "../src/providers/shared/http";

const originalFetch = globalThis.fetch;

// biome-ignore lint/suspicious/noExplicitAny: Bun fetch has extra static properties; tests only need call signature.
function mockFetch(fn: (...args: any[]) => Promise<Response>) {
  // biome-ignore lint/suspicious/noExplicitAny: intentional fetch mock assignment.
  globalThis.fetch = fn as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDebugEvents();
});

describe("shared HTTP", () => {
  test("recognizes abort errors", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("The operation was aborted."))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  test("does not add debug error events for aborted requests", async () => {
    const ctrl = new AbortController();
    mockFetch(
      mock(async (_url: string | URL | Request, init?: RequestInit) => {
        ctrl.abort();
        throw new DOMException(init?.signal?.reason ?? "The operation was aborted.", "AbortError");
      }),
    );

    await expect(
      fetchWithRetry(
        "https://example.com/api",
        { signal: ctrl.signal },
        { timeoutMs: 1000, attempts: 2, retryDelayMs: 1, timeoutMessage: "timed out" },
        "Jenkins",
      ),
    ).rejects.toThrow();

    expect(getDebugEvents()).toHaveLength(0);
  });

  test("aborts during retry backoff without a second fetch", async () => {
    const ctrl = new AbortController();
    let calls = 0;
    mockFetch(
      mock(async () => {
        calls++;
        return new Response("retry", { status: 500, statusText: "Failed" });
      }),
    );

    const pending = fetchWithRetry(
      "https://example.com/api",
      { signal: ctrl.signal },
      { timeoutMs: 1000, attempts: 3, retryDelayMs: 50, timeoutMessage: "timed out" },
    );
    await new Promise(resolve => setTimeout(resolve, 5));
    ctrl.abort();
    await expect(pending).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
