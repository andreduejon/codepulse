/**
 * Convert a raw hunk header like `@@ -5,6 +12,8 @@ function foo()` into
 * a human-readable string like `Lines 5–10 → 12–19  function foo()`.
 * Falls back to the raw header if parsing fails.
 */
export function formatHunkHeader(raw: string): string {
  const m = raw.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
  if (!m) return raw;

  const oldStart = parseInt(m[1], 10);
  const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
  const newStart = parseInt(m[3], 10);
  const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
  const context = m[5]?.trim() ?? "";

  const fmtRange = (start: number, count: number): string => {
    if (count === 0) return `(empty at ${start})`;
    if (count === 1) return String(start);
    return `${start}\u2013${start + count - 1}`;
  };

  const label = `Lines ${fmtRange(oldStart, oldCount)} \u2192 ${fmtRange(newStart, newCount)}`;
  return context ? `${label}  ${context}` : label;
}
