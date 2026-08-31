import type { OpenShiftResource } from "./types";
import { OPENSHIFT_LOG_FOLLOW_MAX_LINES } from "./types";

export interface OpenShiftWatchEvent {
  type: string;
  object: unknown;
}

export function parseOpenShiftWatchBuffer(buffer: string): { events: OpenShiftWatchEvent[]; rest: string } {
  const events: OpenShiftWatchEvent[] = [];
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown; object?: unknown };
      if (parsed && typeof parsed.type === "string") events.push({ type: parsed.type, object: parsed.object });
    } catch {
      // skip malformed watch line
    }
  }
  return { events, rest };
}

export function isOpenShiftWatchGone(event: OpenShiftWatchEvent): boolean {
  if (event.type !== "ERROR") return false;
  const object = event.object;
  if (typeof object !== "object" || object === null) return false;
  const record = object as Record<string, unknown>;
  if (record.code === 410) return true;
  return record.reason === "Expired" || record.reason === "Gone";
}

export function appendOpenShiftLogFollow(
  existing: string,
  chunk: string,
  maxLines = OPENSHIFT_LOG_FOLLOW_MAX_LINES,
): string {
  const text = existing + chunk;
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

export function shouldFollowOpenShiftLog(resource: OpenShiftResource): boolean {
  if (resource.kind === "Pod") return true;
  return resource.kind === "Build" && resource.status === "running";
}
