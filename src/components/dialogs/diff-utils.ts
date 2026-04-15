/** The kind of a display line in the diff viewer. */
export type DisplayLineKind = "hunk-header" | "add" | "delete" | "context" | "spacer" | "continuation";

/** A single flattened display line built from a parsed diff. */
export interface DisplayLine {
  kind: "hunk-header" | "add" | "delete" | "context" | "spacer";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Flatten all hunks of a FileDiff into a single display-line array. */
import type { FileDiff } from "../../git/types";
export function buildDisplayLines(diff: FileDiff): DisplayLine[] {
  const lines: DisplayLine[] = [];
  for (let i = 0; i < diff.hunks.length; i++) {
    lines.push({ kind: "spacer", content: "" });
    const hunk = diff.hunks[i];
    lines.push({ kind: "hunk-header", content: hunk.header });
    for (const line of hunk.lines) {
      lines.push({
        kind: line.type,
        content: line.content,
        oldLineNo: line.oldLineNo,
        newLineNo: line.newLineNo,
      });
    }
  }
  if (diff.hunks.length > 0) {
    lines.push({ kind: "spacer", content: "" });
  }
  return lines;
}

// ── Gutter helpers ────────────────────────────────────────────────────

/** Width (in characters) needed for a line-number gutter column. */
export function gutterWidth(maxLineNo: number): number {
  return String(maxLineNo).length;
}

/** Pad a line number to a fixed width, or return spaces if undefined. */
export function padLineNo(lineNo: number | undefined, width: number): string {
  if (lineNo === undefined) return " ".repeat(width);
  return String(lineNo).padStart(width);
}

/** Build the merged gutter string: "oldLineNo newLineNo". */
export function buildGutter(
  line: Pick<DisplayLine, "oldLineNo" | "newLineNo">,
  oldWidth: number,
  newWidth: number,
): string {
  return `${padLineNo(line.oldLineNo, oldWidth)} ${padLineNo(line.newLineNo, newWidth)}`;
}

// ── Per-line style helpers ─────────────────────────────────────────────
// These accept theme color strings as parameters so they remain pure and
// framework-agnostic (no SolidJS or opentui imports needed).

/** Foreground color for a diff line kind. */
export function diffLineColor(
  kind: DisplayLineKind,
  colors: { diffAdded: string; diffRemoved: string; accent: string; foreground: string },
): string {
  switch (kind) {
    case "add":
      return colors.diffAdded;
    case "delete":
      return colors.diffRemoved;
    case "hunk-header":
      return colors.accent;
    case "context":
    case "spacer":
    case "continuation":
      return colors.foreground;
  }
}

/** Prefix character (+/-/space/empty) for a diff line kind. */
export function diffLinePrefix(kind: DisplayLineKind): string {
  switch (kind) {
    case "add":
      return "+";
    case "delete":
      return "-";
    case "hunk-header":
    case "spacer":
    case "continuation":
      return "";
    case "context":
      return " ";
  }
}

/** Background color (or undefined) for a diff line kind. */
export function diffLineBg(
  kind: DisplayLineKind,
  colors: { diffAddedBg: string; diffRemovedBg: string },
): string | undefined {
  switch (kind) {
    case "add":
      return colors.diffAddedBg;
    case "delete":
      return colors.diffRemovedBg;
    default:
      return undefined;
  }
}

/**
 * Expand a display line array so that each logical line whose content
 * exceeds `maxWidth` characters is followed by one or more `"continuation"`
 * synthetic rows containing the overflow text.
 *
 * This keeps the virtual-windowing model (1 entry = 1 row) correct while
 * giving the renderer pre-split strings to display directly with `wrapMode="none"`.
 *
 * Lines of kind `"spacer"`, `"hunk-header"`, and `"continuation"` are never
 * split (spacers have no content; hunk-headers are always one line; continuations
 * are already split).
 */
export function expandWithContinuations<T extends { kind: DisplayLineKind; content: string }>(
  lines: T[],
  maxWidth: number,
): Array<T | { kind: "continuation"; content: string; originalKind: DisplayLineKind }> {
  if (maxWidth <= 0) return lines;
  const result: Array<T | { kind: "continuation"; content: string; originalKind: DisplayLineKind }> = [];

  for (const line of lines) {
    if (line.kind === "spacer" || line.kind === "hunk-header" || line.kind === "continuation") {
      result.push(line);
      continue;
    }
    const text = line.content;
    if (text.length <= maxWidth) {
      result.push(line);
      continue;
    }
    // Push the original line with content truncated to first chunk
    result.push({ ...line, content: text.slice(0, maxWidth) });
    // Push continuation rows for the rest
    let offset = maxWidth;
    while (offset < text.length) {
      result.push({
        kind: "continuation",
        content: text.slice(offset, offset + maxWidth),
        originalKind: line.kind,
      });
      offset += maxWidth;
    }
  }
  return result;
}

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

// ── Stats helper ──────────────────────────────────────────────────────

import type { DiffHunk } from "../../git/types";

/**
 * Count total additions and deletions across all hunks of a parsed diff.
 */
export function computeDiffStats(hunks: DiffHunk[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions++;
      else if (line.type === "delete") deletions++;
    }
  }
  return { additions, deletions };
}

// ── Windowed rendering helpers ────────────────────────────────────────

/**
 * Build a prefix-sum array mapping line index → cumulative row offset.
 * `rowOffsets[i]` is the row at which line `i` starts.
 * `rowOffsets[lines.length]` is the total row count.
 * Each display line kind occupies exactly 1 row.
 */
export function buildRowOffsets(lines: readonly { kind: DisplayLineKind }[]): number[] {
  const offsets = new Array<number>(lines.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i + 1] = offsets[i] + 1;
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
