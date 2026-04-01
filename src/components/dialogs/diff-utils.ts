/** The kind of a display line in the diff viewer. */
export type DisplayLineKind = "hunk-header" | "add" | "delete" | "context" | "spacer";

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
    if (count === 0) return "(none)";
    if (count === 1) return String(start);
    return `${start}\u2013${start + count - 1}`;
  };

  const label = `Lines ${fmtRange(oldStart, oldCount)} \u2192 ${fmtRange(newStart, newCount)}`;
  return context ? `${label} \u00b7 ${context}` : label;
}

// ── Windowed rendering helpers ────────────────────────────────────────

/** Row height of each display line kind. All kinds occupy 1 row. */
export function lineRowHeight(_kind: DisplayLineKind): number {
  return 1;
}

/**
 * Build a prefix-sum array mapping line index → cumulative row offset.
 * `rowOffsets[i]` is the row at which line `i` starts.
 * `rowOffsets[lines.length]` is the total row count.
 */
export function buildRowOffsets(lines: readonly { kind: DisplayLineKind }[]): number[] {
  const offsets = new Array<number>(lines.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i + 1] = offsets[i] + lineRowHeight(lines[i].kind);
  }
  return offsets;
}

/**
 * Find the first line index whose row offset is >= `targetRow` using binary search.
 * Returns the index into `rowOffsets` (0-based line index).
 */
export function findLineAtRow(rowOffsets: readonly number[], targetRow: number): number {
  let lo = 0;
  let hi = rowOffsets.length - 2; // last valid line index
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rowOffsets[mid + 1] <= targetRow) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
