import { addDebugEvent, type DebugEventSource, redactDebugValue } from "./events";

export const BANNER = {
  git: {
    logFailed: "Git log failed.",
    fetchFailed: "Git fetch failed.",
    fetchTimedOut: "Git fetch timed out.",
    unreachable: "Git remote unreachable.",
    authFailed: "Git authentication failed.",
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
    tokenExpired: "OpenShift token expired.",
    unavailable: "OpenShift unavailable.",
    inventoryFailed: "OpenShift inventory failed.",
    inventoryPartial: "OpenShift inventory partially failed.",
    invalidNamespace: "OpenShift namespace invalid.",
    timeout: "OpenShift request timed out.",
    watchDenied: "OpenShift watch denied. Resource data might be stale. Reload to refresh.",
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
  return looksLikeGitDump(message) ? classifyGitFailure(message) : fallback;
}

export function classifyGitFailure(detail: string): string {
  const text = detail.toLowerCase();
  if (/\btimeout\b|timed out|time out/.test(text)) return BANNER.git.fetchTimedOut;
  if (/authentication failed|permission denied|could not read username|invalid user/.test(text)) {
    return BANNER.git.authFailed;
  }
  if (
    /unable to access|could not resolve host|failed to connect|connection refused|network is unreachable/.test(text)
  ) {
    return BANNER.git.unreachable;
  }
  return BANNER.git.fetchFailed;
}

export function displayBanner(message: string, fallback: string): string {
  if (isBanner(message)) return message;
  if (looksLikeGitDump(message)) return classifyGitFailure(message);
  if (message.includes("\n") || message.length > 72) return fallback;
  return message;
}

function looksLikeGitDump(message: string): boolean {
  return /fatal:|unable to access|failed to connect|could not resolve host/i.test(message);
}
