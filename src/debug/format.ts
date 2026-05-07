import type { DebugEvent } from "./events";

export function formatDebugTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
}

export function formatDebugEvent(event: DebugEvent): string {
  const parts = [
    formatDebugTimestamp(event.timestamp),
    event.source.padEnd(7),
    event.message,
    event.status ?? "",
    event.durationMs !== undefined ? `${event.durationMs}ms` : "",
  ].filter(Boolean);
  return parts.join("  ");
}
