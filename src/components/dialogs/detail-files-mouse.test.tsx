import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, type ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { UNCOMMITTED_HASH } from "../../constants";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { buildGraph } from "../../git/graph";
import type { CommitDetail, DiffSource, DiffTarget, FileChange, UncommittedDetail } from "../../git/types";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import DetailPanel from "../detail-panel";
import type { DetailNavRef } from "../detail-types";
import { DetailDialog } from "./detail-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

// Input order deliberately differs from tree order: diff navigation uses the original list.
const files: FileChange[] = [
  { path: "z-last.ts", status: "D", additions: 0, deletions: 7 },
  { path: "src/nested/beta.ts", status: "R", additions: 3, deletions: 2 },
  { path: "src/alpha.ts", status: "M", additions: 5, deletions: 1 },
  { path: "docs/deep/readme.md", status: "A", additions: 9, deletions: 0 },
];

async function renderFiles(source: DiffSource = "commit", compact = true, many = false) {
  const committedFiles = many
    ? Array.from({ length: 40 }, (_, i) => ({ ...files[2], path: `file-${String(i).padStart(3, "0")}.ts` }))
    : files;
  const working: UncommittedDetail = {
    staged: files.map(file => ({ ...file })),
    unstaged: files.map(file => ({ ...file, status: "M", additions: 2, deletions: 4 })),
    untracked: files.map(file => ({ ...file, status: "A", additions: 0, deletions: 0 })),
  };
  const detail: CommitDetail = {
    hash: source === "commit" ? "abc123456789" : UNCOMMITTED_HASH,
    shortHash: "abc1234",
    parents: [],
    subject: "Files mouse fixture",
    body: "",
    author: "Alice",
    authorEmail: "alice@example.com",
    authorDate: "2026-10-01T12:00:00Z",
    committer: "Alice",
    committerEmail: "alice@example.com",
    commitDate: "2026-10-01T12:00:00Z",
    refs: [],
    files: committedFiles,
  };
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
      app.actions.setCommits([detail]);
      app.actions.setGraphRows(buildGraph([detail]));
      app.actions.setCommitDetail(detail);
      app.actions.setUncommittedDetail(working);
      app.actions.setDetailActiveTab(source === "commit" ? "files" : source === "stash" ? "stashes" : source);
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
                <box width={62} height={22} flexDirection="column">
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
    { width: 80, height: 30, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const flush = () => setup.flush({ maxPasses: 20 });
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const text = (label: string) => {
    const node = descendants(setup.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText === label,
    );
    if (!(node instanceof TextRenderable)) throw new Error(`Missing text: ${label}`);
    return node;
  };
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const clickAt = async (
    x: number,
    y: number,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    await setup.mockMouse.click(x, y, button);
    await flush();
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await clickAt(x, y, button);
  };
  const move = async (x = 0, y = 0) => {
    await setup.mockMouse.moveTo(x, y);
    await flush();
  };
  const dispose = () => {
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    setup.renderer.destroy();
  };
  try {
    // Exercise the production sidebar-to-dialog navRef handoff.
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
    onOpenDiff,
    onJumpToCommit,
    detail,
    working,
    flush,
    frame,
    point,
    text,
    cell,
    clickAt,
    click,
    move,
    dispose,
  };
}

for (const source of ["commit", "staged", "unstaged", "untracked"] as const) {
  test(`compact ${source} rows hover, collapse and activate exact remapped indices through mouse, keyboard and footer`, async () => {
    const d = await renderFiles(source);
    try {
      expect(d.frame()).toContain("Details");
      expect(d.navRef.itemCount).toBe(7);
      d.actions.setDetailCursorIndex(1);
      await d.flush();
      const hint = source === "commit" ? "view diff" : "diff";
      for (const label of ["docs/deep/", "nested/", "beta.ts", "z-last.ts"]) {
        const { x, y } = d.point(label);
        const bg = d.cell(x, y)?.bg;
        const action = d.state.detailCursorAction();
        const top = d.scrollbox.scrollTop;
        expect(d.text(label).selectable).toBe(false);
        await d.move(x, y);
        expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
        expect(d.state.detailCursorIndex()).toBe(1);
        expect(d.state.detailCursorAction()).toBe(action);
        expect(d.scrollbox.scrollTop).toBe(top);
        await d.clickAt(x, y, MouseButtons.RIGHT);
        expect(d.state.detailCursorIndex()).toBe(1);
        expect(d.navRef.itemCount).toBe(7);
        expect(d.onOpenDiff).not.toHaveBeenCalled();
        await d.move();
        expect(d.cell(x, y)?.bg).toEqual(bg);
      }

      await d.click("nested/");
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.state.detailCursorAction()).toBe("expand");
      expect(d.navRef.itemCount).toBe(6);
      expect(d.frame()).not.toContain("beta.ts");
      await d.click("docs/deep/");
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(5);
      expect(d.frame()).not.toContain("readme.md");

      await d.click("alpha.ts");
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.state.detailCursorAction()).toBe(hint);
      const activeFiles = source === "commit" ? d.detail.files : d.working[source];
      const target = (path: string): DiffTarget => ({
        commitHash: source === "commit" ? d.detail.hash : "",
        filePath: path,
        source,
        status: activeFiles.find(file => file.path === path)?.status,
        fileList: activeFiles.map(file => file.path),
        fileIndex: activeFiles.findIndex(file => file.path === path),
      });
      expect(d.onOpenDiff).toHaveBeenCalledTimes(1);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("src/alpha.ts"));
      d.mockInput.pressKey("RETURN");
      await d.flush();
      expect(d.onOpenDiff).toHaveBeenCalledTimes(2);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("src/alpha.ts"));
      await d.click(`enter ${hint}`);
      expect(d.onOpenDiff).toHaveBeenCalledTimes(3);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("src/alpha.ts"));

      await d.click("nested/");
      expect(d.state.detailCursorIndex()).toBe(2);
      expect(d.state.detailCursorAction()).toBe("collapse");
      expect(d.navRef.itemCount).toBe(6);
      await d.click("beta.ts");
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("src/nested/beta.ts"));
      await d.click("z-last.ts");
      expect(d.state.detailCursorIndex()).toBe(5);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("z-last.ts"));

      // Every native text child and blank padding are part of the row hit area.
      const row = d.text("z-last.ts").parent?.parent;
      if (!row) throw new Error("Missing file row");
      const rowTexts = descendants(row).filter((node): node is TextRenderable => node instanceof TextRenderable);
      expect(rowTexts.length).toBe(source === "untracked" ? 3 : 5);
      for (const node of rowTexts) {
        expect(node.selectable).toBe(false);
        d.actions.setDetailCursorIndex(0);
        await d.flush();
        await d.clickAt(node.x, node.y);
        expect(d.state.detailCursorIndex()).toBe(5);
        expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("z-last.ts"));
      }
      await d.clickAt(row.x + row.width - 1, row.y);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("z-last.ts"));
      d.actions.setDetailCursorIndex(0);
      await d.flush();
      d.mockInput.pressKey("RETURN");
      await d.flush();
      expect(d.navRef.itemCount).toBe(7);
      expect(d.state.detailCursorAction()).toBe("collapse");
      await d.click("readme.md");
      expect(d.state.detailCursorIndex()).toBe(1);
      expect(d.onOpenDiff).toHaveBeenLastCalledWith(target("docs/deep/readme.md"));
      expect(d.renderer.getSelection()).toBeNull();
      expect(d.onJumpToCommit).not.toHaveBeenCalled();
    } finally {
      d.dispose();
    }
  });
}

test("working-tree tab clicks guard right/disabled tabs and reset collapsed rows and diff source", async () => {
  const d = await renderFiles("unstaged");
  try {
    await d.click("nested/");
    await d.click("Staged (4)", MouseButtons.RIGHT);
    expect(d.state.detailActiveTab()).toBe("unstaged");
    expect(d.navRef.itemCount).toBe(6);
    for (const [label, source] of [
      ["Staged (4)", "staged"],
      ["Untracked (4)", "untracked"],
      ["Unstaged (4)", "unstaged"],
    ] as const) {
      await d.click(label);
      expect(d.state.detailActiveTab()).toBe(source);
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(7);
      await d.click("beta.ts");
      expect(d.onOpenDiff).toHaveBeenLastCalledWith({
        commitHash: "",
        filePath: "src/nested/beta.ts",
        source,
        status: d.working[source][1].status,
        fileList: d.working[source].map(file => file.path),
        fileIndex: 1,
      });
    }
    d.actions.setUncommittedDetail({ ...d.working, staged: [] });
    await d.flush();
    const cursor = d.state.detailCursorIndex();
    const tab = d.point("Staged (0)");
    await d.move(tab.x, tab.y);
    await d.click("Staged (0)");
    expect(d.state.detailActiveTab()).toBe("unstaged");
    expect(d.state.detailCursorIndex()).toBe(cursor);
    expect(d.cell(tab.x, tab.y)?.fg).toEqual(RGBA.fromHex(d.theme.border));
    expect(d.onOpenDiff).toHaveBeenCalledTimes(3);
  } finally {
    d.dispose();
  }
});

test("native wheel over file rows scrolls without activating or moving the detail cursor", async () => {
  const d = await renderFiles("commit", true, true);
  try {
    const { x, y } = d.point("file-002.ts");
    for (let i = 0; i < 5; i++) await d.mockMouse.scroll(x, y, "down");
    await d.flush();
    expect(d.scrollbox.scrollTop).toBeGreaterThan(0);
    const top = d.scrollbox.scrollTop;
    await d.mockMouse.scroll(x, y, "up");
    await d.flush();
    expect(d.scrollbox.scrollTop).toBeLessThan(top);
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.state.detailActiveTab()).toBe("files");
    expect(d.onOpenDiff).not.toHaveBeenCalled();
  } finally {
    d.dispose();
  }
});

test("sidebar committed and working-tree rows require mouse opt-in and stay selectable", async () => {
  for (const source of ["commit", "staged", "unstaged", "untracked"] as const) {
    const d = await renderFiles(source, false);
    try {
      d.actions.setDetailCursorIndex(1);
      await d.flush();
      for (const label of ["nested/", "beta.ts", "z-last.ts"]) {
        const { x, y } = d.point(label);
        const bg = d.cell(x, y)?.bg;
        expect(d.text(label).selectable).toBe(true);
        await d.move(x, y);
        expect(d.cell(x, y)?.bg).toEqual(bg);
        await d.clickAt(x, y);
        expect(d.state.detailCursorIndex()).toBe(1);
        expect(d.navRef.itemCount).toBe(7);
      }
      expect(d.onOpenDiff).not.toHaveBeenCalled();
      expect(d.onJumpToCommit).not.toHaveBeenCalled();
    } finally {
      d.dispose();
    }
  }
});
