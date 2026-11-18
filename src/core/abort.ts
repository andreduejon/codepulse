/** Waiting that an abort signal stops, and telling an abort from other errors. */

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

export function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || err.message === "The operation was aborted.";
}
