/**
 * Search query parsing and commit matching logic.
 *
 * Supports two modes:
 * - Substring: plain text, case-insensitive match against commit fields.
 * - Regex: `/pattern/` syntax (leading and trailing `/`). Falls back to
 *   substring match if the regex is invalid.
 */

import type { Commit } from "./git/types";

export type SearchMode = "substring" | "regex";

export interface ParsedSearch {
  /** Original query string as submitted by the user. */
  raw: string;
  mode: SearchMode;
  /** Lowercased query for substring mode; unused in regex mode. */
  substring: string;
  /** Compiled regex for regex mode; null in substring mode. */
  regex: RegExp | null;
}

/**
 * Parse a raw search query string into a structured search descriptor.
 *
 * - If the query matches `/pattern/` (at least one char between slashes),
 *   attempt to compile as a case-insensitive regex.
 * - If compilation fails, fall back to substring mode using the raw text.
 * - Empty query returns a descriptor that matches everything.
 */
export function parseSearchQuery(raw: string): ParsedSearch {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, mode: "substring", substring: "", regex: null };
  }

  // Detect /pattern/ syntax — must have at least one char between slashes
  if (trimmed.length >= 3 && trimmed.startsWith("/") && trimmed.endsWith("/")) {
    const pattern = trimmed.slice(1, -1);
    try {
      const regex = new RegExp(pattern, "i");
      return { raw, mode: "regex", substring: "", regex };
    } catch {
      // Invalid regex — fall back to substring
      return { raw, mode: "substring", substring: trimmed.toLowerCase(), regex: null };
    }
  }

  return { raw, mode: "substring", substring: trimmed.toLowerCase(), regex: null };
}

/**
 * Test whether a commit matches the given parsed search.
 *
 * Searches against: subject, author, shortHash, and ref names.
 * Returns true for empty queries (matches everything).
 */
export function matchCommit(commit: Commit, search: ParsedSearch): boolean {
  // Empty query matches everything
  if (search.mode === "substring" && !search.substring) return true;

  const fields = [commit.subject, commit.author, commit.shortHash, ...commit.refs.map(r => r.name)];

  if (search.mode === "regex" && search.regex) {
    return fields.some(f => search.regex!.test(f));
  }

  // Substring mode
  const query = search.substring;
  return fields.some(f => f.toLowerCase().includes(query));
}
