/** Where a Debug event comes from: Git, a provider (by its display name), or an error. */
export type DebugEventSource = "Git" | "error" | (string & {});

export interface DebugEvent {
  timestamp: number;
  source: DebugEventSource;
  message: string;
  status?: string;
  durationMs?: number;
}

const MAX_DEBUG_EVENTS = 100;

/**
 * The Debug dialog's log: the newest events first, at most 100. The app writes to `debugLog`, the process's: the
 * adapters and services reach it directly, so apps in one process share it.
 */
export class DebugLog {
  private events: DebugEvent[] = [];
  /** The messages `addOnce` has put in, so a repeated one (read again on every reload) stays out. */
  private reported = new Set<string>();

  add(event: Omit<DebugEvent, "timestamp"> & { timestamp?: number }): void {
    this.events.unshift({ timestamp: event.timestamp ?? Date.now(), ...event });
    if (this.events.length > MAX_DEBUG_EVENTS) this.events.length = MAX_DEBUG_EVENTS;
  }

  /** Adds an event unless one with the same message came before, even if the log was cleared since. */
  addOnce(event: Omit<DebugEvent, "timestamp">): void {
    if (this.reported.has(event.message)) return;
    this.reported.add(event.message);
    this.add(event);
  }

  all(): DebugEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** The process's debug log. */
export const debugLog = new DebugLog();

export function addDebugEvent(event: Omit<DebugEvent, "timestamp"> & { timestamp?: number }): void {
  debugLog.add(event);
}

export function getDebugEvents(): DebugEvent[] {
  return debugLog.all();
}

export function clearDebugEvents(): void {
  debugLog.clear();
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
