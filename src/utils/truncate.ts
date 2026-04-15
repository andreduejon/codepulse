/**
 * Truncates a name to at most `maxLen` characters using end truncation.
 * If the name exceeds `maxLen`, it is sliced and `...` is appended.
 *
 * Edge cases:
 *   - maxLen <= 0 : returns ""
 *   - maxLen 1–3  : returns name.slice(0, maxLen) — no room for ellipsis
 *
 * Used for colored badge renders (ref badges, menu badges) where CSS-level
 * `truncate` can't be used because it would also clip the badge background.
 *
 * @example
 * truncateName("origin/feature/JIRA-1234-long", 20) // "origin/feature/JIR..."
 * truncateName("main", 20) // "main"
 */
export function truncateName(name: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (name.length <= maxLen) return name;
  if (maxLen <= 3) return name.slice(0, maxLen);
  return `${name.slice(0, maxLen - 3)}...`;
}
