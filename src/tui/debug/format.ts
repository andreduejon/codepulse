import type { DebugEvent } from "../../core/debug-events";

export function formatDebugTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
}

export function formatDebugDuration(durationMs?: number): string {
  return durationMs !== undefined ? `${Math.round(durationMs)}ms` : "";
}

/**
 * A failed command or request: what its source says (Snyk exits 1 with findings, not failing), else an error event, a
 * non-zero exit or an HTTP 4xx/5xx.
 */
export function isFailedDebugStatus(event: Pick<DebugEvent, "status" | "failed">): boolean {
  if (event.failed !== undefined) return event.failed;
  const status = event.status ?? "";
  if (status === "error") return true;
  if (/^exit [1-9]\d*$/.test(status)) return true;
  if (/^\d{3}$/.test(status)) return Number(status) >= 400;
  return false;
}

export function formatDebugStatus(status?: string): string {
  return status ?? "";
}

export function formatDebugMessage(event: DebugEvent): string {
  return event.message;
}
