import type { ProviderView } from "../../core/provider-model";
import type { UIMessage } from "../components/message-box";

/** The providers whose error status the dashboard reports (Snyk's: a scan that failed, also on its own tab). */
export const DASHBOARD_FETCHING_PROVIDERS = [
  "github-actions",
  "jenkins",
  "openshift",
  "snyk",
] as const satisfies readonly ProviderView[];

/** A provider's failed fetch or scan, as its own tab words it. */
export interface FetchError {
  source: string;
  message: string;
}

/** One error's identity: closing the box remembers it, and a new text shows again. */
export const fetchErrorKey = (error: FetchError): string => `${error.source}\n${error.message}`;

/** `GitHub`, `GitHub and Jenkins`, `GitHub, Jenkins and OpenShift`. */
const names = (sources: readonly string[]): string =>
  sources.length <= 2 ? sources.join(" and ") : `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}`;

/**
 * The dashboard's message box for the providers whose fetches failed: one error reads as on its provider's tab,
 * several share one box with a line each (every provider's message starts with its name).
 */
export function dashboardFetchMessage(errors: readonly FetchError[]): UIMessage | null {
  const [first] = errors;
  if (!first) return null;
  if (errors.length === 1) return { kind: "error", source: first.source, message: first.message };
  return {
    kind: "error",
    title: `Errors from ${names(errors.map(error => error.source))}`,
    message: errors.map(error => error.message).join("\n"),
  };
}
