import { addDebugEvent, type DebugEventSource, redactDebugValue } from "../../debug/events";

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

export const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isAbortError(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || err.message === "The operation was aborted.";
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

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(opts.timeoutMessage)), opts.timeoutMs);
  const externalSignal = init.signal;
  const onAbort = () => ctrl.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions,
  source: DebugEventSource = "error",
): Promise<Response> {
  let lastError: unknown = null;
  const started = Date.now();
  const message = requestMessage(url, init);
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, opts);
      if (!isRetryableStatus(res.status) || attempt === opts.attempts) {
        addDebugEvent({ source, message, status: String(res.status), durationMs: Date.now() - started });
        return res;
      }
    } catch (err) {
      if (isAbortError(err, init.signal)) throw err;
      lastError = err;
      if (attempt === opts.attempts) {
        addDebugEvent({
          source: "error",
          message: redactDebugValue(err instanceof Error ? err.message : String(err)),
          durationMs: Date.now() - started,
        });
        throw err;
      }
    }
    await sleep(opts.retryDelayMs * attempt, init.signal);
  }
  throw lastError;
}
