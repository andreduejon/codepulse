export type DebugEventSource = "Git" | "GitHub" | "Jenkins" | "error";

export interface DebugEvent {
  timestamp: number;
  source: DebugEventSource;
  message: string;
  status?: string;
  durationMs?: number;
}

const MAX_DEBUG_EVENTS = 100;
const debugEvents: DebugEvent[] = [];

export function addDebugEvent(event: Omit<DebugEvent, "timestamp"> & { timestamp?: number }): void {
  debugEvents.unshift({ timestamp: event.timestamp ?? Date.now(), ...event });
  if (debugEvents.length > MAX_DEBUG_EVENTS) debugEvents.length = MAX_DEBUG_EVENTS;
}

export function getDebugEvents(): DebugEvent[] {
  return [...debugEvents];
}

export function clearDebugEvents(): void {
  debugEvents.length = 0;
}

export function redactDebugValue(value: string): string {
  return value
    .replace(
      /(authorization|token|access_token|id_token|refresh_token|api[_-]?key|signature|sig)=([^&\s]+)/gi,
      "$1=********",
    )
    .replace(/(Authorization:\s*)([^\s]+)/gi, "$1********")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1********")
    .replace(/(Basic\s+)[A-Za-z0-9._~+/=-]+/gi, "$1********");
}
