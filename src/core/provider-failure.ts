/**
 * What kind of failure a provider's error is, beside its message: a service acts on the kind, never on the wording, so
 * any adapter can say it. `auth`: the credentials were refused (automatic requests stop until a Reload). `partial`: a
 * rescan kept the complete snapshot it had (a warning, not an error).
 */
export type ProviderFailure = "auth" | "partial";

const KINDS: ReadonlySet<string> = new Set<ProviderFailure>(["auth", "partial"]);

/** Thrown by an adapter with the kind of failure beside its message. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly failure: ProviderFailure,
  ) {
    super(message);
  }
}

/** Thrown by an adapter when the server refused the credentials (401, a login page). */
export class ProviderAuthError extends ProviderError {
  constructor(message: string) {
    super(message, "auth");
  }
}

/** The kind of a caught error, when an adapter gave one. */
export function failureOf(error: unknown): ProviderFailure | undefined {
  const failure = typeof error === "object" && error !== null ? (error as { failure?: unknown }).failure : undefined;
  return typeof failure === "string" && KINDS.has(failure) ? (failure as ProviderFailure) : undefined;
}
