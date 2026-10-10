import { expect, mock, spyOn, test } from "bun:test";
import { type Renderable, RGBA, type ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { buildGraph } from "../../git/graph";
import * as repo from "../../git/repo";
import type { Commit, CommitDetail, DiffTarget, FileChange } from "../../git/types";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import DetailPanel from "../detail-panel";
import type { DetailNavRef } from "../detail-types";
import { DetailDialog } from "./detail-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

// Original order differs from tree order, so diff navigation must use the cache.
const files: FileChange[] = [
  { path: "z-last.ts", status: "D", additions: 0, deletions: 7 },
  { path: "src/nested/beta.ts", status: "R", additions: 3, deletions: 2 },
  { path: "src/alpha.ts", status: "M", additions: 5, deletions: 1 },
];
const secondFiles: FileChange[] = [{ path: "other/second.ts", status: "A", additions: 2, deletions: 0 }];

async function renderStashes(compact = true, deferred = false) {
  const detail: CommitDetail = {
    hash: "abc123456789",
    shortHash: "abc1234",
    parents: [],
    subject: "Stash mouse fixture",
    body: "",
    author: "Alice",
    authorEmail: "alice@example.com",
    authorDate: "2026-10-01T12:00:00Z",
    committer: "Alice",
    committerEmail: "alice@example.com",
    commitDate: "2026-10-01T12:00:00Z",
    refs: [],
    files: [],
  };
  const stashes: Commit[] = [0, 1].map(index => ({
    ...detail,
    hash: `stash-hash-${index}`,
    parents: [detail.hash],
    subject: `Saved work ${index}`,
    refs: [{ name: `stash@{${index}}`, type: "stash", isCurrent: false }],
  }));
  let resolveFiles!: (value: FileChange[]) => void;
  const pending = new Promise<FileChange[]>(resolve => (resolveFiles = resolve));
  const load = spyOn(repo, "getStashFiles").mockImplementation(async (_path, hash) =>
    hash === stashes[0].hash ? (deferred ? pending : files) : secondFiles,
  );
  const theme = createThemeState();
  const navRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
    itemRefs: [],
  };
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
  const [showCompact, setShowCompact] = createSignal(false);
  const onOpenDiff = mock((_target: DiffTarget) => {});
  const onJumpToCommit = mock((_hash: string) => {});
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setRepoPath("/stash-mouse-fixture");
      app.actions.setCommits([detail]);
      app.actions.setGraphRows(buildGraph([detail]));
      app.actions.setCommitDetail(detail);
      app.actions.setStashByParent(new Map([[detail.hash, stashes]]));
      app.actions.setDetailActiveTab("stashes");
      app.actions.setDetailFocused(true);
      app.actions.setDetailCursorIndex(0);
      useKeyboard(event =>
        handleDetailKey(event, {
          ...app,
          dialog: () => (compact ? "detail" : null),
          getDetailScrollboxRef: () => scrollbox,
          detailNavRef: navRef,
        }),
      );
      const props = {
        navRef,
        searchFocused: false,
        onOpenDiff,
        onJumpToCommit,
        scrollboxRef: (el: ScrollBoxRenderable) => (scrollbox = el),
      };
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <Show
              when={showCompact()}
              fallback={
                <box width={62} height={32} flexDirection="column">
                  <DetailPanel {...props} />
                </box>
              }
            >
              <DetailDialog {...props} onClose={() => {}} />
            </Show>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 80, height: 40, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const flush = () => setup.flush({ maxPasses: 20 });
  const frame = () => setup.captureCharFrame();
  const text = (label: string) => {
    const node = descendants(setup.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText.includes(label),
    );
    if (!(node instanceof TextRenderable)) throw new Error(`Missing text: ${label}`);
    return node;
  };
  const point = (label: string) => {
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await flush();
  };
  const dispose = () => {
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    setup.renderer.destroy();
    load.mockRestore();
  };
  try {
    await flush();
    setShowCompact(compact);
    await flush();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    ...setup,
    ...app,
    navRef,
    scrollbox,
    theme: theme.theme(),
    stashes,
    load,
    resolveFiles,
    onOpenDiff,
    onJumpToCommit,
    flush,
    frame,
    text,
    point,
    cell,
    click,
    dispose,
  };
}

test("compact stash headers and files hover without cursor changes and ignore right clicks", async () => {
  const d = await renderStashes();
  try {
    expect(d.frame()).toContain("Details");
    expect(d.navRef.itemCount).toBe(2);
    expect(d.load).not.toHaveBeenCalled();
    for (const label of ["stash@{1}", "stash@{0}"]) {
      d.actions.setDetailCursorIndex(label === "stash@{1}" ? 0 : 1);
      await d.flush();
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      const cursor = d.state.detailCursorIndex();
      const action = d.state.detailCursorAction();
      const top = d.scrollbox.scrollTop;
      expect(d.text(label).selectable).toBe(false);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
      expect(d.state.detailCursorIndex()).toBe(cursor);
      expect(d.state.detailCursorAction()).toBe(action);
      expect(d.scrollbox.scrollTop).toBe(top);
      await d.click(label, MouseButtons.RIGHT);
      expect(d.navRef.itemCount).toBe(2);
      expect(d.load).not.toHaveBeenCalled();
      expect(d.state.detailCursorIndex()).toBe(cursor);
      await d.mockMouse.moveTo(0, 0);
      await d.flush();
      expect(d.cell(x, y)?.bg).toEqual(bg);
    }
    await d.click("stash@{0}");
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.state.detailCursorAction()).toBe("collapse");
    expect(d.navRef.itemCount).toBe(7);
    expect(d.load).toHaveBeenCalledWith("/stash-mouse-fixture", d.stashes[0].hash);
    for (const label of ["src/", "nested/", "beta.ts", "z-last.ts"]) {
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      const top = d.scrollbox.scrollTop;
      expect(d.text(label).selectable).toBe(false);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.state.detailCursorAction()).toBe("collapse");
      expect(d.scrollbox.scrollTop).toBe(top);
      await d.click(label, MouseButtons.RIGHT);
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(7);
      expect(d.onOpenDiff).not.toHaveBeenCalled();
      await d.mockMouse.moveTo(0, 0);
      await d.flush();
      expect(d.cell(x, y)?.bg).toEqual(bg);
    }
    expect(d.onJumpToCommit).not.toHaveBeenCalled();
  } finally {
    d.dispose();
  }
});

test("stash directory and header shifts route exact indices to cached stash diff dispatch", async () => {
  const d = await renderStashes();
  const target = (stashIndex: number, path: string): DiffTarget => {
    const list = stashIndex === 0 ? files : secondFiles;
    return {
      commitHash: d.stashes[stashIndex].hash,
      filePath: path,
      source: "stash",
      status: list.find(file => file.path === path)?.status,
      fileList: list.map(file => file.path),
      fileIndex: list.findIndex(file => file.path === path),
    };
  };
  try {
    await d.click("stash@{0}");
    await d.click("stash@{1}");
    expect(d.state.detailCursorIndex()).toBe(6);
    expect(d.navRef.itemCount).toBe(9);
    await d.click("nested/");
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.state.detailCursorAction()).toBe("expand");
    expect(d.navRef.itemCount).toBe(8);
    expect(d.frame()).not.toContain("beta.ts");
    await d.click("alpha.ts");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.state.detailCursorAction()).toBe("diff");
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(0, "src/alpha.ts"));
    d.mockInput.pressKey("RETURN");
    await d.flush();
    await d.click("enter diff");
    expect(d.onOpenDiff).toHaveBeenCalledTimes(3);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(0, "src/alpha.ts"));
    await d.click("src/");
    expect(d.navRef.itemCount).toBe(6);
    await d.click("z-last.ts");
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(0, "z-last.ts"));
    await d.click("second.ts");
    expect(d.state.detailCursorIndex()).toBe(5);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(1, "other/second.ts"));
    await d.click("stash@{0}");
    expect(d.navRef.itemCount).toBe(4);
    await d.click("stash@{1}");
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.state.detailCursorAction()).toBe("expand");
    expect(d.navRef.itemCount).toBe(2);
    await d.click("stash@{1}");
    await d.click("second.ts");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(1, "other/second.ts"));
    await d.click("stash@{0}");
    await d.click("src/");
    await d.click("nested/");
    expect(d.navRef.itemCount).toBe(9);
    await d.click("beta.ts");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(0, "src/nested/beta.ts"));
    const row = d.text("beta.ts").parent?.parent;
    if (!row) throw new Error("Missing stash file row");
    expect(d.navRef.itemRefs[3]).toBe(row);
    const rowTexts = descendants(row).filter((node): node is TextRenderable => node instanceof TextRenderable);
    const labels = rowTexts.map(node => node.plainText);
    expect(labels).toEqual(["│  │  └─ ", "beta.ts", "R", "+3", " -2"]);
    for (const label of labels) {
      // Cursor changes rebuild stash rows; resolve live text nodes after every flush.
      d.actions.setDetailCursorIndex(0);
      await d.flush();
      const currentRow = d.text("beta.ts").parent?.parent;
      if (!currentRow) throw new Error("Missing stash file row");
      expect(d.navRef.itemRefs[3]).toBe(currentRow);
      const node = descendants(currentRow).find(
        (node): node is TextRenderable => node instanceof TextRenderable && node.plainText === label,
      );
      if (!node) throw new Error(`Missing stash row text: ${label}`);
      expect(node.selectable).toBe(false);
      const visibleText = label.trim();
      const x = node.x + label.length - label.trimStart().length;
      expect(node.y).toBe(d.point("beta.ts").y);
      expect(x).toBeGreaterThanOrEqual(currentRow.x);
      expect(x + visibleText.length).toBeLessThanOrEqual(currentRow.x + currentRow.width);
      const renderedRow = d.frame().split("\n")[node.y];
      expect(renderedRow?.slice(x, x + visibleText.length)).toBe(visibleText);
      const calls = d.onOpenDiff.mock.calls.length;
      await d.mockMouse.click(x, node.y);
      await d.flush();
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.onOpenDiff).toHaveBeenCalledTimes(calls + 1);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target(0, "src/nested/beta.ts"));
    }
    expect(d.load).toHaveBeenCalledTimes(2);
    expect(d.renderer.getSelection()).toBeNull();
    expect(d.onJumpToCommit).not.toHaveBeenCalled();
  } finally {
    d.dispose();
  }
});

test("stash expansion stays asynchronous and reuses loaded files after collapse", async () => {
  const d = await renderStashes(true, true);
  try {
    expect(d.load).not.toHaveBeenCalled();
    await d.click("stash@{0}");
    expect(d.frame()).toContain("Saved work 0");
    expect(d.frame()).not.toContain("beta.ts");
    expect(d.navRef.itemCount).toBe(2);
    expect(d.load).toHaveBeenCalledTimes(1);
    d.resolveFiles(files);
    await d.flush();
    expect(d.navRef.itemCount).toBe(7);
    expect(d.frame()).toContain("stash@{0} (3)");
    expect(d.frame()).toContain("beta.ts");
    const header = d.text("stash@{0} (3)").parent;
    if (!header) throw new Error("Missing stash header row");
    expect(d.navRef.itemRefs[0]).toBe(header);
    await d.click("stash@{0}");
    expect(d.frame()).not.toContain("beta.ts");
    await d.click("stash@{0}");
    expect(d.frame()).toContain("beta.ts");
    expect(d.load).toHaveBeenCalledTimes(1);
  } finally {
    d.dispose();
  }
});

test("sidebar stash headers and files remain selectable with mouse controls disabled", async () => {
  const d = await renderStashes(false);
  try {
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.navRef.itemCount).toBe(7);
    for (const label of ["stash@{1}", "stash@{0}", "nested/", "beta.ts", "z-last.ts"]) {
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      expect(d.text(label).selectable).toBe(true);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.bg).toEqual(bg);
      await d.click(label);
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(7);
    }
    expect(d.load).toHaveBeenCalledTimes(1);
    expect(d.onOpenDiff).not.toHaveBeenCalled();
    expect(d.onJumpToCommit).not.toHaveBeenCalled();
  } finally {
    d.dispose();
  }
});
