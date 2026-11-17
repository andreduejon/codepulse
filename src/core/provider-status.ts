/** A provider's status as the app shows it (idle, loading, a problem with its message), built without any UI. */

export type ProviderStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "warning"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export const providerIdle = (): ProviderStatus => ({ kind: "idle" });
export const providerLoading = (): ProviderStatus => ({ kind: "loading" });
export const providerUnavailable = (message: string): ProviderStatus => ({
  kind: "unavailable",
  message,
});
export const providerError = (message: string): ProviderStatus => ({ kind: "error", message });
export const providerWarning = (message: string): ProviderStatus => ({ kind: "warning", message });

export function providerStatusMessage(status: ProviderStatus): string | null {
  return status.kind === "error" || status.kind === "warning" || status.kind === "unavailable" ? status.message : null;
}
