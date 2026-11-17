/** A GitHub host name as the settings may name it. */
import type { GitHubRepo } from "./types";

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

/**
 * Parse a GitHub (or GitHub Enterprise) repository's `owner`, `repo`, and
 * `hostname` from a git remote URL.
 *
 * Supported formats (any hostname):
 *   https://<host>/owner/repo[.git][/]
 *   git@<host>:owner/repo[.git]
 *   ssh://[git@]<host>/owner/repo[.git][/]
 *
 * Returns `null` for URLs that do not match the owner/repo path pattern,
 * or any malformed input.
 */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  if (!url) return null;

  const trimmed = url.trim();

  // HTTPS: https://<host>/owner/repo[.git][/]
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const hostname = httpsMatch[1];
    const owner = httpsMatch[2];
    const repo = httpsMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  // SSH scp-style: git@<host>:owner/repo[.git]
  const sshScpMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshScpMatch) {
    const hostname = sshScpMatch[1];
    const owner = sshScpMatch[2];
    const repo = sshScpMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  // SSH protocol: ssh://[git@]<host>/owner/repo[.git][/]
  const sshProtoMatch = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshProtoMatch) {
    const hostname = sshProtoMatch[1];
    const owner = sshProtoMatch[2];
    const repo = sshProtoMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  return null;
}

export function isTrustedGitHubHost(hostname: string, trustedEnterpriseHost: string | null = null): boolean {
  const normalized = normalizeGitHubHost(hostname);
  if (!normalized) return false;
  if (normalized === "github.com") return true;
  return trustedEnterpriseHost != null && normalizeGitHubHost(trustedEnterpriseHost) === normalized;
}
