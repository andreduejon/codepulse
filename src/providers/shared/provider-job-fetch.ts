import { debugError } from "../../debug/banner";
import type { DebugEventSource } from "../../debug/events";
import { isAbortError } from "./http";

export type ProviderJobFetchOutcome<T> =
  | { kind: "result"; jobs: T[]; error: string | null }
  | { kind: "cancelled" }
  | { kind: "rejected"; jobs: T[]; error: string };

export async function fetchProviderJobs<T>(
  fetcher: () => Promise<{ jobs: T[]; error: string | null }>,
  signal: AbortSignal,
  debugSource: DebugEventSource,
): Promise<ProviderJobFetchOutcome<T>> {
  try {
    const result = await fetcher();
    return { kind: "result", ...result };
  } catch (err) {
    if (isAbortError(err, signal)) return { kind: "cancelled" };
    debugError(debugSource, err);
    return { kind: "rejected", jobs: [], error: "Unavailable" };
  }
}
