/** A GitHub host name as the settings may name it. */

/**
 * Normalize a user-entered GitHub host. Accepts host or host:port only.
 * Rejects protocols, paths, auth, query/hash, and whitespace.
 */
export function normalizeGitHubHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("://") || /[/?#@\s]/.test(trimmed)) return null;

  try {
    const url = new URL(`https://${trimmed}`);
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (url.hostname !== "github.com" && !url.hostname.includes(".")) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}
