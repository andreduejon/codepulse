import { addDebugEvent, type DebugEventSource, redactDebugValue } from "./events";

export const BANNER = {
  git: {
    logFailed: "Git log failed.",
    fetchFailed: "Git fetch failed.",
    detailFailed: "Git detail failed.",
  },
  github: {
    disabled: "GitHub is disabled.",
    noRemote: "GitHub unavailable. No remote.",
    untrustedHost: "GitHub unavailable. Untrusted host.",
    missingToken: (envVar: string) => `GitHub unavailable. Missing ${envVar}.`,
    unavailable: "GitHub unavailable.",
    rateLimit: "GitHub rate limit exceeded.",
    fetchFailed: "GitHub fetch failed.",
    jobsFailed: "GitHub jobs failed.",
    logFailed: "GitHub log failed.",
    timeout: "GitHub request timed out.",
  },
  jenkins: {
    noJobs: "Jenkins unavailable. No jobs configured.",
    noUsername: "Jenkins unavailable. Username not configured.",
    missingToken: (envVar: string) => `Jenkins unavailable. Missing ${envVar}.`,
    authFailed: "Jenkins authentication failed.",
    fetchFailed: "Jenkins fetch failed.",
    invalidJobUrl: "Jenkins job URL invalid.",
    timeout: "Jenkins request timed out.",
  },
  openshift: {
    noServer: "OpenShift unavailable. Server URL not configured.",
    noNamespaces: "OpenShift unavailable. No namespaces configured.",
    missingToken: (envVar: string) => `OpenShift unavailable. Missing ${envVar}.`,
    unavailable: "OpenShift unavailable.",
    inventoryFailed: "OpenShift inventory failed.",
    inventoryPartial: "OpenShift inventory partially failed.",
    invalidNamespace: "OpenShift namespace invalid.",
    timeout: "OpenShift request timed out.",
  },
} as const;

const STATIC_BANNERS = new Set<string>(
  Object.values(BANNER).flatMap(group =>
    Object.values(group).filter((value): value is string => typeof value === "string"),
  ),
);

export function isBanner(message: string): boolean {
  return STATIC_BANNERS.has(message);
}

export function debugError(source: DebugEventSource, detail: unknown): void {
  const message = redactDebugValue(detail instanceof Error ? detail.message : String(detail)).trim();
  if (!message) return;
  addDebugEvent({ source, message, status: "error" });
}

export function bannerOrFallback(err: unknown, fallback: string, source: DebugEventSource): string {
  const message = err instanceof Error ? err.message : String(err);
  if (isBanner(message)) return message;
  debugError(source, message);
  return fallback;
}
