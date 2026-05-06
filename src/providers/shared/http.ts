export interface FetchWithRetryOptions {
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
  timeoutMessage: string;
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
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, opts);
      if (!isRetryableStatus(res.status) || attempt === opts.attempts) return res;
    } catch (err) {
      lastError = err;
      if (attempt === opts.attempts) throw err;
    }
    await sleep(opts.retryDelayMs * attempt);
  }
  throw lastError;
}
