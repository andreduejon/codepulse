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
  test("the line comes straight into the head along its own column, by the target's commit, else by its branch", () => {
    expect(mergePreviewSpan(ROWS, { head: "head", base: "main", baseRef: "main" }, 4, 12)).toEqual({
      top: 0,
      bottom: 2,
      topNode: 0,
      bottomNode: 1,
      column: 1,
      extra: false,
      target: "top",
      direct: "bottom",
    });
    // GitHub's commit isn't loaded: the branch's.
    expect(mergePreviewSpan(ROWS, { head: "head", base: "gone", baseRef: "main" }, 4, 12)?.top).toBe(0);
  });

  test("a row's empty connectors (the graph keeps them for spacing) leave a column free", () => {
    const withEmpty = (r: GraphRow) =>
      ({
        ...r,
        connectors: [
          { type: "empty", column: 1, color: 0 },
          { type: "empty", column: 2, color: 0 },
        ],
      }) as GraphRow;
    const rows = [withEmpty(row("main", 0)), withEmpty(row("other", 0)), row("head", 1)];
    expect(mergePreviewSpan(rows, { head: "head", base: "main", baseRef: "main" }, 4, 12)).toMatchObject({
      column: 1,
      direct: "bottom",
    });
  });

  test("a line in the head's column between them: the first column right of both that none uses; else one more", () => {
    const preview = { head: "head", base: "main", baseRef: "main" };
    const busy = (...active: number[]) => [row("main", 0), row("other", 0, [], active), row("head", 1)];
    expect(mergePreviewSpan(busy(1), preview, 4, 12)).toMatchObject({ column: 2, direct: null });
    expect(mergePreviewSpan(busy(1, 2), preview, 4, 12)?.column).toBe(3);
    // Every column taken: one more, right of the lanes, while the graph has room for it.
    expect(mergePreviewSpan(busy(1, 2), preview, 3, 12)).toMatchObject({ column: 3, extra: true });
    // A head left of the target can't be come into from above: the column right of both.
    const headLeft = [row("main", 1), row("head", 0)];
    expect(mergePreviewSpan(headLeft, preview, 4, 12)).toMatchObject({ column: 2, direct: null });
  });

  test("no line when an end is missing, both are one commit, or the graph has no column left", () => {
    expect(mergePreviewSpan(ROWS, { head: "gone", base: "main", baseRef: "main" }, 2, 12)).toBeNull();
    expect(mergePreviewSpan(ROWS, { head: "main", base: "main", baseRef: "main" }, 2, 12)).toBeNull();
    const busy = [row("main", 0), row("other", 0, [], [1]), row("head", 1)];
    expect(mergePreviewSpan(busy, { head: "head", base: "main", baseRef: "main" }, 2, 2)).toBeNull();
    expect(mergePreviewSpan(ROWS, null, 2, 12)).toBeNull();
  });

  test("straight into the head: the target's line turns down into its column, the head's own line stays", () => {
    const span = {
      top: 0,
      bottom: 2,
      topNode: 0,
      bottomNode: 1,
      column: 1,
      extra: false,
      target: "top" as const,
      direct: "bottom" as const,
    };
    expect(text(withMergePreview(chars("█ "), span, 0, "commit", "muted"))).toBe("█◀╮ ");
    expect(text(withMergePreview(chars("│ "), span, 1, "commit", "muted"))).toBe("│ │ ");
    expect(text(withMergePreview(chars("│ █ "), span, 2, "commit", "muted"))).toBe("│ █ ");
  });

  test("each end's line reaches the column, the target's with ◀; a lane it crosses is ┼; the lines between carry it", () => {
    const span = {
      top: 0,
      bottom: 2,
      topNode: 0,
      bottomNode: 1,
      column: 2,
      extra: false,
      target: "top" as const,
      direct: null,
    };
    expect(text(withMergePreview(chars("█ "), span, 0, "commit", "muted"))).toBe("█◀──╮ ");
    expect(text(withMergePreview(chars("│ "), span, 0, "below", "muted"))).toBe("│   │ ");
    // Lanes left and right of it stay.
    expect(text(withMergePreview(chars("│ │   │ "), span, 1, "commit", "muted"))).toBe("│ │ │ │ ");
    expect(text(withMergePreview(chars("│ █ "), span, 2, "commit", "muted"))).toBe("│ █─╯ ");
    expect(text(withMergePreview(chars("│ ╮ "), span, 2, "above", "muted"))).toBe("│ ╮ │ ");
    // Its own cells muted; a lane it crosses keeps its colour.
    const crossing = withMergePreview(chars("█ │ "), { ...span, column: 3 }, 0, "commit", "muted");
    expect(text(crossing)).toBe("█◀┼───╮ ");
    expect(crossing.slice(0, 4).map(cell => cell.color)).toEqual(["lane", "muted", "lane", "muted"]);
    // The head's end when the target is below it: no arrow there, the target's has it.
    const below = { ...span, target: "bottom" as const };
    expect(text(withMergePreview(chars("█ "), below, 0, "commit", "muted"))).toBe("█───╮ ");
    expect(text(withMergePreview(chars("│ █ "), below, 2, "commit", "muted"))).toBe("│ █◀╯ ");
    // Outside the span, and the bottom's connector: as they were.
    expect(text(withMergePreview(chars("│ "), span, 2, "below", "muted"))).toBe("│ ");
    expect(text(withMergePreview(chars("│ "), span, 3, "commit", "muted"))).toBe("│ ");
  });
});
