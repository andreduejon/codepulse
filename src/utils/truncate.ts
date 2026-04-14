/**
 * Truncates a name to at most `maxLen` characters using end truncation.
 * If the name exceeds `maxLen`, it is sliced and `...` is appended.
 *
 * Used for colored badge renders (ref badges, menu badges) where CSS-level
 * `truncate` can't be used because it would also clip the badge background.
 *
 * @example
 * truncateName("origin/feature/JIRA-1234-long", 20) // "origin/feature/JIR..."
 * truncateName("main", 20) // "main"
 */
export function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen - 3)}...`;
}
