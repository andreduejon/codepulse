import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";
import { fetchWithRetry, isAbortError, runLimited } from "../src/providers/shared/http";

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

  test("runLimited does not start remaining items after abort", async () => {
    const ctrl = new AbortController();
    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const pending = runLimited(
      [1, 2, 3, 4, 5, 6, 7, 8],
      2,
      async () => {
        started++;
        if (started === 2) ctrl.abort();
        await barrier;
      },
      ctrl.signal,
    );
    release();
    await expect(pending).rejects.toThrow();
    expect(started).toBe(2);
  });
});

describe("the response body", () => {
  /** A local server: `/stall` sends its headers and one chunk, then nothing; `/slow` a chunk every 80 ms, six times. */
  let cancelled = 0;
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/stall")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first chunk "));
            },
            cancel() {
              cancelled++;
            },
          }),
        );
      if (path === "/slow") {
        let sent = 0;
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(80);
              controller.enqueue(new TextEncoder().encode(`chunk ${sent} `));
              if (++sent === 6) controller.close();
            },
          }),
        );
      }
      // `/retry`: busy once (its body never ends), then fine.
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("busy"));
            },
            cancel() {
              cancelled++;
            },
          }),
          { status: 503 },
        );
      return new Response("ok");
    },
  });
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const options = { timeoutMs: 250, attempts: 1, retryDelayMs: 1, timeoutMessage: "Request timed out." };

  test("a server that sends its headers and then stalls times out while the body is read", async () => {
    const res = await fetchWithRetry(url("/stall"), {}, options);
    const started = performance.now();
    await expect(res.text()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("cancelling after the headers stops reading the body", async () => {
    const ctrl = new AbortController();
    const res = await fetchWithRetry(url("/stall"), { signal: ctrl.signal }, { ...options, timeoutMs: 60_000 });
    setTimeout(() => ctrl.abort(), 50);
    const started = performance.now();
    await expect(res.text()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("a body that keeps coming slowly is read whole: the timeout is for silence, not for the whole download", async () => {
    const res = await fetchWithRetry(url("/slow"), {}, options);
    expect(await res.text()).toBe("chunk 0 chunk 1 chunk 2 chunk 3 chunk 4 chunk 5 ");
  });

  test("a response retried is closed, not left open", async () => {
    cancelled = 0;
    const res = await fetchWithRetry(url("/retry"), {}, { ...options, attempts: 2, timeoutMs: 60_000 });
    expect(await res.text()).toBe("ok");
    for (let i = 0; i < 50 && cancelled === 0; i++) await Bun.sleep(10);
    expect(cancelled).toBe(1);
  });

  afterAll(() => server.stop(true));
});
