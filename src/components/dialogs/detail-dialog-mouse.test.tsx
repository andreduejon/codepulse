import { expect, mock, spyOn, test } from "bun:test";
import { type Renderable, RGBA, type ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { buildGraph } from "../../git/graph";
import type { CommitDetail, DiffTarget } from "../../git/types";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import * as clipboard from "../../hooks/use-clipboard";
import { getDefaultDetailTab } from "../../utils/tab-utils";
import DetailPanel from "../detail-panel";
import type { DetailNavRef } from "../detail-types";
import { DetailDialog } from "./detail-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderDetail(compact = true, fileCount = 40, family = false, jumpNavigation = false) {
  const detail: CommitDetail = {
    hash: "abc123456789",
    shortHash: "abc1234",
    parents: family ? ["def123456789"] : [],
    subject: "Mouse detail fixture",
    body: "Fixture body",
    author: "Alice",
    authorEmail: "alice@example.com",
    authorDate: "2026-10-01T12:00:00Z",
    committer: "Alice",
    committerEmail: "alice@example.com",
    commitDate: "2026-10-01T12:00:00Z",
    refs: [{ name: "main", type: "branch", isCurrent: true }],
    files: Array.from({ length: fileCount }, (_, index) => ({
      path: `file-${String(index + 1).padStart(3, "0")}.ts`,
      status: "M",
      additions: 1,
      deletions: 0,
    })),
  };
  const commits = family
    ? [
        { ...detail, hash: "fed123456789", parents: [detail.hash], refs: [] },
        detail,
        { ...detail, hash: "def123456789", parents: [], refs: [] },
      ]
    : [detail];
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
  const [open, setOpen] = createSignal(true);
  const [showCompact, setShowCompact] = createSignal(false);
  const close = mock(() => setOpen(false));
  const onOpenDiff = mock((_target: DiffTarget) => {});
  let isJumpNavigation = false;
  const commitChanged = mock((_hash: string, _isJumpNavigation: boolean) => {});
  const onJumpToCommit = mock((hash: string, from: "child" | "parent") => {
    if (!jumpNavigation) return;
    const index = app.state.graphRows().findIndex(row => row.commit.hash === hash);
    if (index < 0) return;
    navRef.lastJumpFrom = from;
    navRef.pendingJumpDirection = from;
    // Match AppContent: the loader must observe this flag before the setter returns.
    isJumpNavigation = true;
    app.actions.setCursorIndex(index);
    isJumpNavigation = false;
  });
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setCommits(commits);
      app.actions.setGraphRows(buildGraph(commits));
      if (family) app.actions.setCursorIndex(1);
      app.actions.setCommitDetail(detail);
      app.actions.setDetailFocused(true);
      app.actions.setDetailCursorIndex(0);
      if (jumpNavigation) {
        // Model useDetailLoader's synchronous commit-change/tab-reset effect.
        createEffect(() => {
          const commit = app.state.selectedCommit();
          const provider = app.state.activeProviderView();
          if (!commit) return;
          commitChanged(commit.hash, isJumpNavigation);
          if (!isJumpNavigation) {
            app.actions.setDetailActiveTab(getDefaultDetailTab(commit, provider));
            app.actions.setDetailCursorIndex(0);
            navRef.pendingJumpDirection = null;
          }
        });
      }
      useKeyboard(event => {
        if (!open()) return;
        if (event.name === "escape") close();
        else
          handleDetailKey(event, {
            ...app,
            dialog: () => (compact ? "detail" : null),
            getDetailScrollboxRef: () => scrollbox,
            detailNavRef: navRef,
          });
      });
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
            <Show when={open()}>
              <Show
                when={showCompact()}
                fallback={
                  <box width={62} height={22} flexDirection="column">
                    <DetailPanel {...props} />
                  </box>
                }
              >
                <DetailDialog {...props} onClose={close} />
              </Show>
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
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const text = (label: string) => {
    const node = descendants(setup.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText === label,
    );
    if (!(node instanceof TextRenderable)) throw new Error(`Missing text: ${label}`);
    return node;
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
    // The sidebar populates the shared navRef before the compact dialog opens.
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
    detail,
    navRef,
    scrollbox,
    theme: theme.theme(),
    open,
    close,
    onOpenDiff,
    onJumpToCommit,
    commitChanged,
    flush,
    frame,
    point,
    cell,
    text,
    clickAt,
    click,
    move,
    dispose,
  };
}

test("compact tabs hover without switching and accept only left clicks across top, text padding and bottom", async () => {
  const d = await renderDetail();
  try {
    expect(d.frame()).toContain("Details");
    expect(d.frame()).toContain("file-001.ts");
    expect(d.navRef.itemCount).toBe(40);
    const info = d.point("Info");
    const tab = d.text("Info").parent?.parent;
    if (!tab) throw new Error("Missing Info tab box");
    expect(tab.height).toBe(3);
    expect(tab.width).toBeGreaterThan("Info".length);
    const filesTab = d.text("Files (40)").parent?.parent;
    if (!filesTab) throw new Error("Missing Files tab box");
    expect(filesTab.x + filesTab.width).toBe(tab.x);
    for (const y of [info.y - 1, info.y + 1]) {
      expect(
        d
          .frame()
          .split("\n")
          [y].slice(filesTab.x, tab.x + tab.width),
      ).toBe("─".repeat(filesTab.width + tab.width));
    }
    for (const [x, y] of [
      [info.x, info.y - 1],
      [info.x, info.y],
      [tab.x, info.y],
      [tab.x + tab.width - 1, info.y],
      [info.x, info.y + 1],
    ]) {
      d.actions.setDetailCursorIndex(3);
      d.scrollbox.scrollTo(8);
      await d.flush();
      const top = d.scrollbox.scrollTop;
      expect(top).toBeGreaterThan(0);
      await d.move(x, y);
      expect(d.state.detailActiveTab()).toBe("files");
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.scrollbox.scrollTop).toBe(top);
      expect(d.cell(info.x, info.y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
      expect(d.cell(info.x, info.y - 1)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
      await d.clickAt(x, y, MouseButtons.RIGHT);
      expect(d.state.detailActiveTab()).toBe("files");
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.scrollbox.scrollTop).toBe(top);
      await d.move();
      expect(d.cell(info.x, info.y)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
      expect(d.cell(info.x, info.y - 1)?.fg).toEqual(RGBA.fromHex(d.theme.border));
      await d.clickAt(x, y);
      expect(d.state.detailActiveTab()).toBe("info");
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.state.detailCursorAction()).toBe("copy");
      expect(d.scrollbox.scrollTop).toBe(0);
      expect(d.frame()).toContain("Alice");
      expect(d.cell(info.x, info.y)?.fg).toEqual(RGBA.fromHex(d.theme.accent));
      await d.click("Files (40)");
      expect(d.state.detailActiveTab()).toBe("files");
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.state.detailCursorAction()).toBe("view diff");
    }
    expect(d.onOpenDiff).not.toHaveBeenCalled();
    expect(d.onJumpToCommit).not.toHaveBeenCalled();
    for (const width of [79, 78, 77]) {
      d.resize(width, 30);
      await d.flush();
      const infoTab = d.text("Info").parent?.parent;
      const filesTab = d.text("Files (40)").parent?.parent;
      if (!infoTab || !filesTab) throw new Error("Missing tabs after resize");
      expect(filesTab.x + filesTab.width).toBe(infoTab.x);
      expect(filesTab.width + infoTab.width).toBe(d.scrollbox.width);
      expect([filesTab.width, infoTab.width].sort((a, b) => a - b)).toEqual([
        Math.floor(d.scrollbox.width / 2),
        Math.ceil(d.scrollbox.width / 2),
      ]);
      for (const y of [infoTab.y, infoTab.y + 2]) {
        expect(
          d
            .frame()
            .split("\n")
            [y].slice(filesTab.x, infoTab.x + infoTab.width),
        ).toBe("─".repeat(filesTab.width + infoTab.width));
      }
    }
  } finally {
    d.dispose();
  }
});

test("compact footer Enter invokes the real current file activation, is nonselectable, and title close works", async () => {
  const d = await renderDetail();
  try {
    d.navRef.scrollToFile("file-002.ts");
    await d.flush();
    expect(d.text("enter view diff").selectable).toBe(false);
    const { x, y } = d.point("view diff");
    const bg = d.cell(x, y)?.bg;
    await d.move(x, y);
    expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
    expect(d.cell(x, y)?.bg).toEqual(bg);
    await d.click("enter view diff", MouseButtons.RIGHT);
    expect(d.onOpenDiff).not.toHaveBeenCalled();
    await d.click("enter view diff");
    const target: DiffTarget = {
      commitHash: d.detail.hash,
      filePath: "file-002.ts",
      source: "commit",
      status: "M",
      fileList: d.detail.files.map(file => file.path),
      fileIndex: 1,
    };
    expect(d.onOpenDiff).toHaveBeenCalledTimes(1);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target);
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.onOpenDiff).toHaveBeenCalledTimes(2);
    expect(d.onOpenDiff).toHaveBeenLastCalledWith(target);
    expect(d.renderer.getSelection()).toBeNull();
    expect(d.text("esc close").selectable).toBe(false);
    await d.click("esc close", MouseButtons.RIGHT);
    expect(d.close).not.toHaveBeenCalled();
    await d.click("esc close");
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(d.open()).toBe(false);
    expect(d.frame()).not.toContain("Details");
  } finally {
    d.dispose();
  }
});

test("empty Files tab ignores hover and clicks; footer Enter is disabled when there are no items", async () => {
  const d = await renderDetail(true, 0);
  try {
    expect(d.navRef.itemCount).toBe(0);
    expect(d.frame()).toContain("No modified files");
    expect(d.text("enter").selectable).toBe(false);
    expect(d.text(" select").selectable).toBe(false);
    await d.click("enter select");
    expect(d.onOpenDiff).not.toHaveBeenCalled();
    expect(d.renderer.getSelection()).toBeNull();
    await d.click("Info");
    d.actions.setDetailCursorIndex(2);
    await d.flush();
    const files = d.point("Files (0)");
    for (const y of [files.y - 1, files.y, files.y + 1]) {
      await d.move(files.x, y);
      expect(d.cell(files.x, files.y)?.fg).toEqual(RGBA.fromHex(d.theme.border));
      expect(d.cell(files.x, files.y - 1)?.fg).toEqual(RGBA.fromHex(d.theme.border));
      await d.clickAt(files.x, y);
      expect(d.state.detailActiveTab()).toBe("info");
      expect(d.state.detailCursorIndex()).toBe(2);
      expect(d.state.detailCursorAction()).toBe("copy");
    }
  } finally {
    d.dispose();
  }
});

test("native wheel scrolls compact detail without activating files; sidebar tab clicks require mouse opt-in", async () => {
  const d = await renderDetail();
  try {
    const sb = d.scrollbox;
    for (let i = 0; i < 5; i++) await d.mockMouse.scroll(sb.x + 6, sb.y + 2, "down");
    await d.flush();
    expect(sb.scrollTop).toBeGreaterThan(0);
    expect(d.frame()).not.toContain("file-001.ts");
    expect(d.state.detailActiveTab()).toBe("files");
    expect(d.state.detailCursorIndex()).toBe(0);
    const top = sb.scrollTop;
    await d.mockMouse.scroll(sb.x + 6, sb.y + 2, "up");
    await d.flush();
    expect(sb.scrollTop).toBeLessThan(top);
    expect(d.onOpenDiff).not.toHaveBeenCalled();
  } finally {
    d.dispose();
  }
  const sidebar = await renderDetail(false);
  try {
    sidebar.actions.setDetailCursorIndex(3);
    sidebar.scrollbox.scrollTo(8);
    await sidebar.flush();
    const top = sidebar.scrollbox.scrollTop;
    const info = sidebar.point("Info");
    for (const y of [info.y - 1, info.y, info.y + 1]) {
      await sidebar.move(info.x, y);
      expect(sidebar.cell(info.x, info.y)?.fg).toEqual(RGBA.fromHex(sidebar.theme.foregroundMuted));
      await sidebar.clickAt(info.x, y);
      expect(sidebar.state.detailActiveTab()).toBe("files");
      expect(sidebar.state.detailCursorIndex()).toBe(3);
      expect(sidebar.scrollbox.scrollTop).toBe(top);
    }
    expect(sidebar.onOpenDiff).not.toHaveBeenCalled();
  } finally {
    sidebar.dispose();
  }
});

test("compact Info copies exact fields, highlights on hover without moving the cursor, and preserves general text selection", async () => {
  const copy = mock((_text: string, _field: string) => {});
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  let d: Awaited<ReturnType<typeof renderDetail>> | undefined;
  try {
    d = await renderDetail();
    await d.click("Info");
    d.actions.setDetailCursorIndex(2);
    await d.flush();
    for (const [label, field, value, index] of [
      [d.detail.hash, "hash", d.detail.hash, 0],
      ["Alice <alice@example.com>", "author", "Alice <alice@example.com>", 1],
      ["Fixture body", "body", d.detail.body, 4],
    ] as const) {
      d.scrollbox.scrollTo(field === "body" ? 100 : 0);
      await d.flush();
      const { x, y } = d.point(label);
      const cursor = d.state.detailCursorIndex();
      const action = d.state.detailCursorAction();
      const top = d.scrollbox.scrollTop;
      const bg = d.cell(x, y)?.bg;
      const calls = copy.mock.calls.length;
      expect(d.text(label).selectable).toBe(false);
      expect(d.navRef.itemRefs[index]).toBe(d.text(label).parent as Renderable);
      await d.move(x, y);
      expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
      expect(d.state.detailCursorIndex()).toBe(cursor);
      expect(d.state.detailCursorAction()).toBe(action);
      expect(d.scrollbox.scrollTop).toBe(top);
      await d.clickAt(x, y, MouseButtons.RIGHT);
      expect(copy).toHaveBeenCalledTimes(calls);
      expect(d.state.detailCursorIndex()).toBe(cursor);
      await d.move();
      expect(d.cell(x, y)?.bg).toEqual(bg);
      await d.clickAt(x, y);
      expect(d.state.detailCursorIndex()).toBe(index);
      expect(copy).toHaveBeenLastCalledWith(value, field);
      expect(copy).toHaveBeenCalledTimes(calls + 1);
      expect(d.renderer.getSelection()).toBeNull();
    }
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(copy).toHaveBeenLastCalledWith(d.detail.body, "body");
    expect(copy).toHaveBeenCalledTimes(4);
    d.scrollbox.scrollTo(0);
    await d.flush();
    expect(d.text("Branch").selectable).toBe(true);
    expect(d.text(" main ").selectable).toBe(true);
  } finally {
    d?.dispose();
    clipboardSpy.mockRestore();
  }
});

test("compact Info toggles headers and navigates exact family entries after flat indices shift", async () => {
  const d = await renderDetail(true, 1, true);
  try {
    await d.click("Info");
    d.scrollbox.scrollTo(100);
    await d.flush();
    expect(d.navRef.itemCount).toBe(9);
    for (const label of ["Children (1)", "fed1234", "Parents (1)", "def1234"]) {
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      expect(d.text(label.includes("(1)") ? `▾ ${label}` : label).selectable).toBe(false);
      await d.move(x, y);
      expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
      expect(d.state.detailCursorIndex()).toBe(0);
      await d.clickAt(x, y, MouseButtons.RIGHT);
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(9);
      expect(d.onJumpToCommit).not.toHaveBeenCalled();
      await d.move();
      expect(d.cell(x, y)?.bg).toEqual(bg);
    }
    await d.click("Children (1)");
    expect(d.state.detailCursorIndex()).toBe(5);
    expect(d.navRef.itemCount).toBe(8);
    expect(d.state.detailCursorAction()).toBe("expand");
    expect(d.frame()).not.toContain("fed1234");
    await d.click("def1234");
    expect(d.state.detailCursorIndex()).toBe(7);
    expect(d.state.detailCursorAction()).toBe("jump");
    expect(d.onJumpToCommit).toHaveBeenLastCalledWith("def123456789", "parent");
    await d.click("Children (1)");
    expect(d.navRef.itemCount).toBe(9);
    await d.click("fed1234");
    expect(d.state.detailCursorIndex()).toBe(6);
    expect(d.onJumpToCommit).toHaveBeenLastCalledWith("fed123456789", "child");
    const parentEntry = d.text("def1234").parent;
    if (!parentEntry) throw new Error("Missing parent entry");
    const badge = parentEntry
      .getChildren()
      .find(node => node instanceof TextRenderable && node.plainText !== "def1234");
    if (!badge) throw new Error("Missing parent badge");
    expect(badge.selectable).toBe(false);
    await d.clickAt(badge.x + 1, badge.y);
    expect(d.state.detailCursorIndex()).toBe(8);
    expect(d.onJumpToCommit).toHaveBeenLastCalledWith("def123456789", "parent");
    await d.click("Parents (1)");
    expect(d.state.detailCursorIndex()).toBe(7);
    expect(d.navRef.itemCount).toBe(8);
    expect(d.frame()).not.toContain("def1234");
    expect(d.renderer.getSelection()).toBeNull();
  } finally {
    d.dispose();
  }
});

test("compact Info parent clicks and keyboard Enter preserve the tab during the synchronous jump flag", async () => {
  for (const input of ["mouse", "keyboard"] as const) {
    const d = await renderDetail(true, 1, true, true);
    try {
      expect(d.commitChanged).toHaveBeenLastCalledWith(d.detail.hash, false);
      await d.click("Info");
      d.scrollbox.scrollTo(100);
      await d.flush();
      if (input === "mouse") {
        await d.click("def1234");
      } else {
        const parentIndex = d.navRef.itemRefs.indexOf(d.text("def1234").parent as Renderable);
        expect(parentIndex).toBeGreaterThanOrEqual(0);
        d.actions.setDetailCursorIndex(parentIndex);
        await d.flush();
        d.mockInput.pressKey("RETURN");
        await d.flush();
      }
      expect(d.onJumpToCommit).toHaveBeenCalledTimes(1);
      expect(d.onJumpToCommit).toHaveBeenLastCalledWith("def123456789", "parent");
      expect(d.state.selectedCommit()?.hash).toBe("def123456789");
      expect(d.commitChanged).toHaveBeenLastCalledWith("def123456789", true);
      expect(d.state.detailActiveTab()).toBe("info");
      expect(d.navRef.pendingJumpDirection).toBe("parent");

      // Ordinary graph navigation exercises the same effect's real tab-reset branch.
      d.actions.setCursorIndex(1);
      await d.flush();
      expect(d.commitChanged).toHaveBeenLastCalledWith(d.detail.hash, false);
      expect(d.state.detailActiveTab()).toBe("files");
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.pendingJumpDirection).toBeNull();
    } finally {
      d.dispose();
    }
  }
});

test("sidebar Info mouse actions stay disabled and its content stays selectable", async () => {
  const copy = mock((_text: string, _field: string) => {});
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  let d: Awaited<ReturnType<typeof renderDetail>> | undefined;
  try {
    d = await renderDetail(false, 1, true);
    d.actions.setDetailActiveTab("info");
    d.actions.setDetailCursorIndex(2);
    await d.flush();
    for (const label of [d.detail.hash, "Children (1)", "fed1234", "Parents (1)", "def1234"]) {
      d.scrollbox.scrollTo(label === d.detail.hash ? 0 : 100);
      await d.flush();
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      await d.move(x, y);
      expect(d.cell(x, y)?.bg).toEqual(bg);
      await d.clickAt(x, y);
      expect(d.state.detailCursorIndex()).toBe(2);
      expect(d.navRef.itemCount).toBe(9);
    }
    expect(d.text("def1234").selectable).toBe(true);
    expect(copy).not.toHaveBeenCalled();
    expect(d.onJumpToCommit).not.toHaveBeenCalled();
  } finally {
    d?.dispose();
    clipboardSpy.mockRestore();
  }
});
