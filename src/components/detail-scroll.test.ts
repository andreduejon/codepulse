import { expect, test } from "bun:test";
import type { GraphRow } from "../git/types";
import { type CursoredTextSource, cursoredItemText } from "./detail-scroll";

const source = (overrides: Partial<CursoredTextSource> = {}): CursoredTextSource => ({
  row: { childBranches: ["feature/a-very-long-branch-name"], parentBranches: [""] } as unknown as GraphRow,
  getTagForHash: () => null,
  stashLabel: index => (index === 0 ? "stash@{0}: WIP on main: a long stash message" : null),
  stashTreeRows: () => [
    { prefix: "", connector: "├── ", name: "src/components/long-file-name.tsx", isDir: true, dirPath: "src", depth: 0 },
  ],
  stashFileWidths: () => ({ addColWidth: 2, delColWidth: 2, totalAdd: 0, totalDel: 0 }),
  copyableText: field => (field === "subject" ? "A subject that is longer than the panel" : "short"),
  ...overrides,
});

test("only text that overflows its columns scrolls, with the columns left after fixed parts", () => {
  // Commit entries lose padding (2), short hash (7), gap (1) and badge padding (2).
  expect(cursoredItemText({ type: "child", hash: "c1", index: 0 }, 32, source())).toEqual({
    text: "feature/a-very-long-branch-name",
    visibleWidth: 20,
  });
  expect(cursoredItemText({ type: "child", hash: "c1", index: 0 }, 60, source())).toBeNull();
  // A parent without a branch falls back to its tag, then to "deleted".
  expect(
    cursoredItemText({ type: "parent", hash: "p1", index: 0 }, 14, source({ getTagForHash: () => "v1.2.3-rc" })),
  ).toEqual({ text: "v1.2.3-rc", visibleWidth: 2 });
  expect(cursoredItemText({ type: "stash-entry", stashHash: "s", stashIndex: 0 }, 20, source())?.visibleWidth).toBe(18);
  expect(cursoredItemText({ type: "stash-entry", stashHash: "s", stashIndex: 1 }, 20, source())).toBeNull();
  expect(
    cursoredItemText({ type: "stash-dir", stashHash: "s", dirPath: "src", index: 0 }, 20, source())?.visibleWidth,
  ).toBe(14);
  expect(cursoredItemText({ type: "copyable", field: "subject" }, 20, source())?.visibleWidth).toBe(20);
  expect(cursoredItemText({ type: "copyable", field: "body" }, 1, source())).toBeNull();
  expect(cursoredItemText({ type: "section-header", section: "children" }, 1, source())).toBeNull();
});
