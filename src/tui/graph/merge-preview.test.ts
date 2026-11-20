import { describe, expect, test } from "bun:test";
import type { GraphRow } from "../../core/git/types";
import { mergePreviewSpan, withMergePreview } from "./merge-preview";
import type { GraphChar } from "./render";

const row = (hash: string, nodeColumn: number, refs: { type: string; name: string }[] = [], active: number[] = []) =>
  ({
    commit: { hash, refs },
    nodeColumn,
    columns: [0, 1, 2, 3].map(column => ({ color: column, active: active.includes(column) })),
    connectors: [],
  }) as unknown as GraphRow;

const ROWS = [row("main", 0, [{ type: "remote", name: "origin/main" }]), row("other", 0), row("head", 1)];
const text = (chars: GraphChar[]) => chars.map(gc => gc.char).join("");
const chars = (line: string): GraphChar[] => [...line].map(char => ({ char, color: "lane" }));

describe("merge preview", () => {
  test("the line runs from the head to the target, by its commit, else by its branch, in a column of its own", () => {
    expect(mergePreviewSpan(ROWS, { head: "head", base: "main", baseRef: "main" }, 4, 12)).toEqual({
      top: 0,
      bottom: 2,
      topNode: 0,
      bottomNode: 1,
      column: 2,
      extra: false,
    });
    // GitHub's commit isn't loaded: the branch's.
    expect(mergePreviewSpan(ROWS, { head: "head", base: "gone", baseRef: "main" }, 2, 12)?.top).toBe(0);
  });

  test("its column is the first right of both ends that no line uses between them; else one more", () => {
    const busy = [row("main", 0), row("other", 0, [], [2]), row("head", 1)];
    expect(mergePreviewSpan(busy, { head: "head", base: "main", baseRef: "main" }, 4, 12)?.column).toBe(3);
    // Every column taken: one more, right of the lanes, while the graph has room for it.
    expect(mergePreviewSpan(busy, { head: "head", base: "main", baseRef: "main" }, 3, 12)).toMatchObject({
      column: 3,
      extra: true,
    });
  });

  test("no line when an end is missing, both are one commit, or the graph has no column left", () => {
    expect(mergePreviewSpan(ROWS, { head: "gone", base: "main", baseRef: "main" }, 2, 12)).toBeNull();
    expect(mergePreviewSpan(ROWS, { head: "main", base: "main", baseRef: "main" }, 2, 12)).toBeNull();
    expect(mergePreviewSpan(ROWS, { head: "head", base: "main", baseRef: "main" }, 2, 2)).toBeNull();
    expect(mergePreviewSpan(ROWS, null, 2, 12)).toBeNull();
  });

  test("each end's line reaches the column over empty cells only; the lines between carry it", () => {
    const span = { top: 0, bottom: 2, topNode: 0, bottomNode: 1, column: 2, extra: false };
    expect(text(withMergePreview(chars("█ "), span, 0, "commit", "muted"))).toBe("█┄┄┄╮ ");
    expect(text(withMergePreview(chars("│ "), span, 0, "below", "muted"))).toBe("│   ┆ ");
    // A lane it crosses stays.
    expect(text(withMergePreview(chars("│ │ "), span, 1, "commit", "muted"))).toBe("│ │ ┆ ");
    // A lane right of it stays too.
    expect(text(withMergePreview(chars("│ │   │ "), span, 1, "commit", "muted"))).toBe("│ │ ┆ │ ");
    expect(text(withMergePreview(chars("│ █ "), span, 2, "commit", "muted"))).toBe("│ █┄╯ ");
    expect(text(withMergePreview(chars("│ ╮ "), span, 2, "above", "muted"))).toBe("│ ╮ ┆ ");
    // Outside the span, and the bottom's connector: as they were.
    expect(text(withMergePreview(chars("│ "), span, 2, "below", "muted"))).toBe("│ ");
    expect(text(withMergePreview(chars("│ "), span, 3, "commit", "muted"))).toBe("│ ");
  });
});
