import { abortError, isAbortError, sleep } from "../core/abort";
import { addDebugEvent, type DebugEventSource, redactDebugValue } from "../core/debug-events";
import { monotonicNow } from "../core/monotonic";

export interface FetchWithRetryOptions {
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
  timeoutMessage: string;
}

function requestMessage(url: string, init: RequestInit): string {
  const method = init.method ?? "GET";
  try {
    const parsed = new URL(url);
    return redactDebugValue(`${method} ${parsed.pathname}${parsed.search}`);
  } catch {
    return redactDebugValue(`${method} ${url}`);
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function runLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      if (signal?.aborted) throw abortError(signal);
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * A request with a timeout. The timeout and the caller's cancel cover the body too, not only the headers: a server can
 * send its headers and then stall. While the body arrives the timeout counts silence, so a large log that keeps coming
 * is read whole.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions,
): Promise<Response> {
  const ctrl = new AbortController();
  const timeout = () => ctrl.abort(new Error(opts.timeoutMessage));
  let timer = setTimeout(timeout, opts.timeoutMs);
  const externalSignal = init.signal;
  const onAbort = () => ctrl.abort(externalSignal?.reason);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  };

  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (error) {
    finish();
    throw error;
  }
  if (!res.body) {
    finish();
    return res;
  }
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finish();
          controller.close();
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(timeout, opts.timeoutMs);
        controller.enqueue(chunk.value);
      } catch (error) {
        finish();
        controller.error(ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : error);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions,
  source: DebugEventSource = "error",
): Promise<Response> {
  let lastError: unknown = null;
  const started = monotonicNow();
  const message = requestMessage(url, init);
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, opts);
      if (!isRetryableStatus(res.status) || attempt === opts.attempts) {
        addDebugEvent({ source, message, status: String(res.status), durationMs: monotonicNow() - started });
        return res;
      }
      // Retried: this answer is not read, so close it.
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      if (isAbortError(err, init.signal)) throw err;
      lastError = err;
      if (attempt === opts.attempts) {
        addDebugEvent({
          source: "error",
          message: redactDebugValue(err instanceof Error ? err.message : String(err)),
          durationMs: monotonicNow() - started,
        });
        throw err;
      }
    }
    await sleep(opts.retryDelayMs * attempt, init.signal);
  }
  throw lastError;
}
