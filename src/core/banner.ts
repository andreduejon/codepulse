import { addDebugEvent, type DebugEventSource, redactDebugValue } from "./debug-events";

/** The messages the app shows as they are, without a fallback: each group's, as it is defined. */
const KNOWN_BANNERS = new Set<string>();

/**
 * A group of banners: its fixed sentences become known, so a failure carrying one shows it as it is. A provider's
 * group is in its own folder (core/<provider>/banner.ts); a banner can only be thrown once its group is loaded.
 */
export function banners<T extends Record<string, string | ((...args: never[]) => string)>>(group: T): T {
  for (const value of Object.values(group)) if (typeof value === "string") KNOWN_BANNERS.add(value);
  return group;
}

export const BANNER = {
  git: banners({
    logFailed: "Git log failed.",
    fetchFailed: "Git fetch failed.",
    fetchTimedOut: "Git fetch timed out.",
    unreachable: "Git remote unreachable.",
    authFailed: "Git authentication failed.",
    detailFailed: "Git detail failed.",
  } as const),
} as const;

export function isBanner(message: string): boolean {
  return KNOWN_BANNERS.has(message);
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

export interface BannerParts {
  title: string;
  detail: string[];
}

/**
 * Splits a banner sentence for display under its source: the first sentence becomes the headline without the
 * source's own name (`GitHub unavailable. Missing GITHUB_TOKEN.` under `GitHub` → `Unavailable` plus
 * `Missing GITHUB_TOKEN.`), later sentences and lines become detail.
 */
export function bannerParts(source: string, message: string): BannerParts {
  const [first = "", ...lines] = message.split("\n");
  const [headline = "", ...sentences] = first.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const detail = [sentences.join(" "), ...lines].filter(line => line.trim().length > 0);
  return { title: withoutSource(headline.replace(/\.$/, ""), source), detail };
}

function withoutSource(headline: string, source: string): string {
  const names = new Set([source, source.split(" ")[0]]);
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (!name || headline.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    const rest = /^\s+(?:is\s+)?(\S.*)$/.exec(headline.slice(name.length))?.[1];
    if (rest) return rest[0].toUpperCase() + rest.slice(1);
  }
  return headline;
}
