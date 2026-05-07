import { addDebugEvent, redactDebugValue, type DebugEventSource } from "../../debug/events";

export interface FetchWithRetryOptions {
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
  timeoutMessage: string;
}

function sourceForUrl(url: string): DebugEventSource {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("github")) return "GitHub";
    if (host.includes("jenkins")) return "Jenkins";
  } catch {}
  return "error";
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

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
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
): Promise<Response> {
  let lastError: unknown = null;
  const started = Date.now();
  const source = sourceForUrl(url);
  const message = requestMessage(url, init);
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, opts);
      if (!isRetryableStatus(res.status) || attempt === opts.attempts) {
        addDebugEvent({ source, message, status: String(res.status), durationMs: Date.now() - started });
        return res;
      }
    } catch (err) {
      lastError = err;
      if (attempt === opts.attempts) {
        addDebugEvent({ source: "error", message: redactDebugValue(err instanceof Error ? err.message : String(err)), durationMs: Date.now() - started });
        throw err;
      }
    }
    await sleep(opts.retryDelayMs * attempt);
  }
  throw lastError;
}
