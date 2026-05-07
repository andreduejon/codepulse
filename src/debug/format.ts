import type { DebugEvent } from "./events";

export function formatDebugTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
}

export function formatDebugEvent(event: DebugEvent): string {
  const parts = [
    formatDebugTimestamp(event.timestamp),
    formatDebugDuration(event.durationMs),
    event.source,
    formatDebugStatus(event.status),
    formatDebugMessage(event),
  ].filter(Boolean);
  return parts.join("  ");
}

export function formatDebugDuration(durationMs?: number): string {
  return durationMs !== undefined ? `${durationMs}ms` : "";
}

export function formatDebugStatus(status?: string): string {
  return status ?? "";
}

export function formatDebugMessage(event: DebugEvent): string {
  return event.message;
}
