import type { DebugEvent } from "./events";

export function formatDebugTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
}

export function formatDebugDuration(durationMs?: number): string {
  return durationMs !== undefined ? `${durationMs}ms` : "";
}

/**
 * A failed command or request: an error event, a non-zero Git exit, an HTTP 4xx/5xx, or a Snyk exit of 2 or more
 * (Snyk exits 1 when it finds vulnerabilities, which is a result, not a failure).
 */
export function isFailedDebugStatus(event: Pick<DebugEvent, "source" | "status">): boolean {
  const status = event.status ?? "";
  if (status === "error") return true;
  if (/^exit [1-9]\d*$/.test(status)) return true;
  if (/^\d{3}$/.test(status)) return Number(status) >= 400;
  if (event.source === "Snyk" && /^\d+$/.test(status)) return Number(status) >= 2;
  return false;
}

export function formatDebugStatus(status?: string): string {
  return status ?? "";
}

export function formatDebugMessage(event: DebugEvent): string {
  return event.message;
}
