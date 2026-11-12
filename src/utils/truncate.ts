import { cellWidth, sliceCells, truncateCells } from "./terminal-text";

/**
 * Truncates a name to at most `maxLen` characters using end truncation.
 * If the name exceeds `maxLen`, it is sliced and `…` is appended (the one truncation marker; `...` means "in progress").
 *
 * Edge cases:
 *   - maxLen <= 0 : returns ""
 *   - maxLen 1    : returns "…"
 *
 * Used for colored badge renders (ref badges, menu badges) where CSS-level
 * `truncate` can't be used because it would also clip the badge background.
 *
 * @example
 * truncateName("origin/feature/JIRA-1234-long", 20) // "origin/feature/JIRA-…"
 * truncateName("main", 20) // "main"
 */
export function truncateName(name: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  // Terminal columns, so wide characters (CJK, emoji) count twice.
  return truncateCells(name, maxLen);
}

/** Cut `text` to `width` columns, ending in `…` when anything was cut (the single-character truncation marker). */
export function endTruncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (cellWidth(text) <= width) return text;
  if (width === 1) return "…";
  return `${sliceCells(text, 0, width - 1).trimEnd()}…`;
}
