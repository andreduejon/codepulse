import { redactDebugValue } from "../../debug/events";

/** Longest reason kept; Maven and Gradle failures can print whole build logs. */
const MAX_REASON_LENGTH = 240;

/** Snyk's own wording where a scan of a clean checkout needs a different fix than Snyk suggests. */
const KNOWN_REASONS: readonly { pattern: RegExp; reason: string }[] = [
  {
    // Snyk suggests `npm install`, but scans run on a clean checkout: only a lockfile helps.
    pattern: /missing node_modules folder/i,
    reason: "Missing node_modules folder. Snyk needs a lockfile for this project, since scans run on a clean checkout.",
  },
];

/** Hints Snyk appends that don't apply to Codepulse's scans. */
const NOISE = [/run with `?-d`? for debug output\.?/gi, /please run '[^']+' first\.?/gi];

/**
 * Snyk's reason for a failed project, from the lines it prints under the project's path: one line, without
 * worktree paths or debug hints, with secrets redacted. Null when nothing readable is left.
 */
export function snykFailureReason(lines: readonly string[], roots: readonly string[]): string | null {
  let text = lines
    .map(line => line.trim())
    .filter(Boolean)
    .join(" ");
  for (const { pattern, reason } of KNOWN_REASONS) if (pattern.test(text)) return reason;
  for (const root of [...roots].sort((a, b) => b.length - a.length)) text = text.replaceAll(`${root}/`, "");
  for (const noise of NOISE) text = text.replace(noise, "");
  text = redactDebugValue(text).replace(/\s+/g, " ").trim();
  if (!/[a-z]/i.test(text)) return null;
  if (text.length > MAX_REASON_LENGTH) text = `${text.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`;
  return text;
}
