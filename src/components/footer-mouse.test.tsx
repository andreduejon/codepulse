import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal } from "solid-js";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import { buildGraph } from "../git/graph";
import type { Commit } from "../git/types";
import { type GraphKeyOptions, openGraphDetails } from "../hooks/handle-graph-keys";
import { type CommandBarMode, type DialogId, useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import type { DetailNavRef } from "./detail-types";
import Footer from "./footer";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

const commit: Commit = {
  hash: "abc123456789",
  shortHash: "abc1234",
  parents: [],
  subject: "Footer mouse fixture",
  body: "",
  author: "Alice",
  authorEmail: "alice@example.com",
  authorDate: "2026-10-01T12:00:00Z",
  committer: "Alice",
  committerEmail: "alice@example.com",
  commitDate: "2026-10-01T12:00:00Z",
  refs: [],
};

async function renderFooter() {
  const theme = createThemeState();
  const [layoutMode, setLayoutMode] = createSignal<ReturnType<GraphKeyOptions["layoutMode"]>>("compact");
  const [mouseEnabled, setMouseEnabled] = createSignal(true);
  const [dialog, setDialog] = createSignal<DialogId>(null);
  const [commandBarMode, setCommandBarMode] = createSignal<CommandBarMode>("idle");
  const [commandBarValue, setCommandBarValue] = createSignal("");
  const [searchFocused, setSearchFocused] = createSignal(false);
  const [searchInputValue, setSearchInputValue] = createSignal("");
  const activateCurrentItem = mock(() => true);
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem,
    lastJumpFrom: null,
    pendingJumpDirection: "parent",
    scrollToFile: () => {},
    itemRefs: [],
  };
  let app!: ReturnType<typeof createAppState>;
  let options!: GraphKeyOptions;
  const onOpenDetails = mock(() => openGraphDetails(options));
  const keyResult = mock((_prevented: boolean) => {});
  const onCommandExecute = mock((_command: string) => {});
  const onPathExecute = mock((path: string) => app.actions.setPathFilter(path));
  const onSearchExecute = mock((query: string) => app.actions.setSearchQuery(query));
  const clearSearchDebounce = mock(() => {});
  const loadData = mock(() => {});
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setLoading(false);
      app.actions.setCommits([commit]);
      app.actions.setGraphRows(buildGraph([commit]));
      app.actions.setDetailCursorIndex(7);
      options = {
        ...app,
        layoutMode,
        setDialog,
        detailNavRef,
        getDetailScrollboxRef: () => undefined,
        loadMoreData: () => {},
        onCommandExecute,
        setCommandBarMode,
        setCommandBarValue,
      };
      const { onFooterEnter, onFooterEscape } = useKeyboardNavigation({
        ...options,
        dialog,
        searchFocused,
        setSearchFocused,
        searchInputValue,
        setSearchInputValue,
        clearSearchDebounce,
        loadData,
        handleFetch: () => {},
        commandBarMode,
        commandBarValue,
        onPathExecute,
        onSearchExecute,
        onClearAncestry: () => app.actions.setAncestrySet(null),
      });
      useKeyboard(event => keyResult(event.defaultPrevented));
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <box width="100%" height={2} flexDirection="column">
              <Footer
                commandBarMode={commandBarMode}
                filterActive={!!(app.state.searchQuery() || app.state.pathFilter() || app.state.viewingBranch())}
                compact={layoutMode() !== "normal"}
                mouseEnabled={mouseEnabled()}
                onOpenDetails={onOpenDetails}
                onConfirm={onFooterEnter}
                onClose={onFooterEscape}
              />
            </box>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 100, height: 6, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const point = (label: string) => {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    if (y < 0) throw new Error(`Missing footer hint: ${label}`);
    return { x: lines[y].indexOf(label) + label.length - 1, y };
  };
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const expectClosed = () => {
    expect(dialog()).toBeNull();
    expect(app.state.detailFocused()).toBe(false);
    expect(app.state.detailCursorIndex()).toBe(7);
    expect(detailNavRef.pendingJumpDirection).toBe("parent");
  };
  const expectOpened = () => {
    expect(dialog()).toBe("detail");
    expect(app.state.detailFocused()).toBe(true);
    expect(app.state.detailCursorIndex()).toBe(0);
    expect(detailNavRef.pendingJumpDirection).toBeNull();
    expect(app.state.selectedCommit()).toEqual(commit);
  };
  try {
    await setup.flush();
  } catch (error) {
    setup.renderer.destroy();
    throw error;
  }
  return {
    ...setup,
    ...app,
    theme: theme.theme(),
    options,
    onOpenDetails,
    keyResult,
    dialog,
    setDialog,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    onCommandExecute,
    onPathExecute,
    onSearchExecute,
    activateCurrentItem,
    clearSearchDebounce,
    loadData,
    setLayoutMode,
    setMouseEnabled,
    point,
    cell,
    expectClosed,
    expectOpened,
  };
}

test("compact footer details hover is text-only, ignores right click, and left click opens shared details", async () => {
  const d = await renderFooter();
  try {
    const { x, y } = d.point("enter details");
    const hint = descendants(d.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText === "enter details",
    );
    expect(hint).toBeInstanceOf(TextRenderable);
    expect((hint as TextRenderable).selectable).toBe(false);
    const before = d.cell(x, y);
    expect(before?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    await d.mockMouse.moveTo(x, y);
    await d.flush();
    expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
    expect(d.cell(x, y)?.bg).toEqual(before?.bg);
    d.expectClosed();
    expect(d.onOpenDetails).not.toHaveBeenCalled();
    await d.mockMouse.click(x, y, MouseButtons.RIGHT);
    await d.flush();
    d.expectClosed();
    expect(d.onOpenDetails).not.toHaveBeenCalled();
    await d.mockMouse.moveTo(0, 3);
    await d.flush();
    expect(d.cell(x, y)?.fg).toEqual(before?.fg);
    await d.mockMouse.click(x, y);
    await d.flush();
    expect(d.onOpenDetails).toHaveBeenCalledTimes(1);
    expect(d.onOpenDetails).toHaveReturnedWith(true);
    d.expectOpened();
    expect(d.renderer.getSelection()).toBeNull();
  } finally {
    d.renderer.destroy();
  }
});

test("compact footer details is disabled without a selected commit, including Enter", async () => {
  const d = await renderFooter();
  try {
    d.actions.setGraphRows([]);
    await d.flush();
    expect(d.state.selectedCommit()).toBeNull();
    for (const label of ["enter", "details"]) {
      const { x, y } = d.point(label);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
      await d.mockMouse.click(x, y);
      await d.flush();
      d.expectClosed();
    }
    expect(d.onOpenDetails).not.toHaveBeenCalled();
    expect(openGraphDetails(d.options)).toBe(false);
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.keyResult).toHaveBeenLastCalledWith(false);
    d.expectClosed();
  } finally {
    d.renderer.destroy();
  }
});

test("mouseEnabled false blocks compact footer clicks while Enter opens the same fixture", async () => {
  const d = await renderFooter();
  try {
    d.setMouseEnabled(false);
    await d.flush();
    const { x, y } = d.point("enter details");
    const before = d.cell(x, y);
    await d.mockMouse.moveTo(x, y);
    await d.flush();
    expect(d.cell(x, y)?.fg).toEqual(before?.fg);
    await d.mockMouse.click(x, y);
    await d.flush();
    expect(d.onOpenDetails).not.toHaveBeenCalled();
    d.expectClosed();
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.keyResult).toHaveBeenLastCalledWith(true);
    d.expectOpened();
  } finally {
    d.renderer.destroy();
  }
});

test("too-small shared guard blocks both the footer action and Enter", async () => {
  const d = await renderFooter();
  try {
    d.setLayoutMode("too-small");
    await d.flush();
    const { x, y } = d.point("enter details");
    await d.mockMouse.click(x, y);
    await d.flush();
    expect(d.onOpenDetails).toHaveBeenCalledTimes(1);
    expect(d.onOpenDetails).toHaveReturnedWith(false);
    d.expectClosed();
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.keyResult).toHaveBeenLastCalledWith(false);
    d.expectClosed();
  } finally {
    d.renderer.destroy();
  }
});

test("normal footer show-details hint opens the shared details action", async () => {
  const d = await renderFooter();
  try {
    d.setLayoutMode("normal");
    await d.flush();
    for (const label of ["enter/→", "show details"]) {
      d.actions.setDetailFocused(false);
      await d.flush();
      const { x, y } = d.point(label);
      const before = d.cell(x, y);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
      expect(d.cell(x, y)?.bg).toEqual(before?.bg);
      await d.mockMouse.click(x, y);
      await d.flush();
      expect(d.state.detailFocused()).toBe(true);
      expect(d.dialog()).toBeNull();
    }
    expect(d.onOpenDetails).toHaveBeenCalledTimes(2);
  } finally {
    d.renderer.destroy();
  }
});

for (const mode of ["command", "path", "search"] as const) {
  test(`footer confirms trimmed ${mode} input through the actual navigation hook`, async () => {
    const d = await renderFooter();
    try {
      d.setCommandBarMode(mode);
      d.setCommandBarValue("  src/components  ");
      d.setSearchInputValue("  Alice  ");
      d.setSearchFocused(mode === "search");
      await d.flush();
      const { x, y } = d.point("enter confirm");
      const before = d.cell(x, y);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
      expect(d.cell(x, y)?.bg).toEqual(before?.bg);
      await d.mockMouse.click(x, y, MouseButtons.RIGHT);
      await d.flush();
      expect(d.commandBarMode()).toBe(mode);
      expect(d.onCommandExecute).not.toHaveBeenCalled();
      expect(d.onPathExecute).not.toHaveBeenCalled();
      expect(d.onSearchExecute).not.toHaveBeenCalled();
      await d.mockMouse.click(x, y);
      await d.flush();
      expect(d.commandBarMode()).toBe("idle");
      expect(d.commandBarValue()).toBe("");
      expect(d.searchFocused()).toBe(false);
      if (mode === "command") expect(d.onCommandExecute).toHaveBeenCalledWith("src/components");
      if (mode === "path") {
        expect(d.onPathExecute).toHaveBeenCalledWith("src/components");
        expect(d.state.pathFilter()).toBe("src/components");
      }
      if (mode === "search") {
        expect(d.onSearchExecute).toHaveBeenCalledWith("Alice");
        expect(d.state.searchQuery()).toBe("Alice");
      }
      expect(d.keyResult).not.toHaveBeenCalled();
    } finally {
      d.renderer.destroy();
    }
  });

  test(`footer cancels ${mode} edits while preserving applied filters`, async () => {
    const d = await renderFooter();
    try {
      d.actions.setSearchQuery("applied query");
      d.actions.setPathFilter("applied/path");
      d.setCommandBarMode(mode);
      d.setCommandBarValue("unapplied/path");
      d.setSearchInputValue("unapplied query");
      d.setSearchFocused(mode === "search");
      await d.flush();
      const { x, y } = d.point("esc cancel");
      await d.mockMouse.click(x, y, MouseButtons.RIGHT);
      await d.flush();
      expect(d.commandBarMode()).toBe(mode);
      await d.mockMouse.click(x, y);
      await d.flush();
      expect(d.commandBarMode()).toBe("idle");
      expect(d.commandBarValue()).toBe("");
      expect(d.searchFocused()).toBe(false);
      expect(d.state.searchQuery()).toBe("applied query");
      expect(d.state.pathFilter()).toBe("applied/path");
      expect(d.clearSearchDebounce).not.toHaveBeenCalled();
      expect(d.onCommandExecute).not.toHaveBeenCalled();
      expect(d.onPathExecute).not.toHaveBeenCalled();
      expect(d.onSearchExecute).not.toHaveBeenCalled();
    } finally {
      d.renderer.destroy();
    }
  });
}

for (const layout of ["compact", "normal"] as const) {
  test(`footer detail copy activation and back share keyboard routing in ${layout} layout`, async () => {
    const d = await renderFooter();
    try {
      d.setLayoutMode(layout);
      openGraphDetails(d.options);
      d.actions.setDetailCursorAction("copy");
      await d.flush();
      const copy = d.point("enter copy");
      await d.mockMouse.click(copy.x, copy.y, MouseButtons.RIGHT);
      await d.flush();
      expect(d.activateCurrentItem).not.toHaveBeenCalled();
      await d.mockMouse.click(copy.x, copy.y);
      await d.flush();
      expect(d.activateCurrentItem).toHaveBeenCalledTimes(1);
      d.mockInput.pressKey("RETURN");
      await d.flush();
      expect(d.activateCurrentItem).toHaveBeenCalledTimes(2);
      d.actions.setGraphRows([]);
      await d.flush();
      const disabledCopy = d.point("copy");
      const before = d.cell(disabledCopy.x, disabledCopy.y);
      await d.mockMouse.moveTo(disabledCopy.x, disabledCopy.y);
      await d.flush();
      expect(d.cell(disabledCopy.x, disabledCopy.y)?.fg).toEqual(before?.fg);
      await d.mockMouse.click(disabledCopy.x, disabledCopy.y);
      await d.flush();
      expect(d.activateCurrentItem).toHaveBeenCalledTimes(2);
      d.actions.setDetailCursorAction(null);
      await d.flush();
      expect(d.captureCharFrame()).not.toContain("enter copy");
      const back = d.point("esc back");
      await d.mockMouse.click(back.x, back.y, MouseButtons.RIGHT);
      await d.flush();
      expect(d.state.detailFocused()).toBe(true);
      await d.mockMouse.click(back.x, back.y);
      await d.flush();
      expect(d.state.detailFocused()).toBe(false);
      expect(d.dialog()).toBeNull();
    } finally {
      d.renderer.destroy();
    }
  });
}

test("footer clear follows search, ancestry, path, and branch cascade one step at a time", async () => {
  const d = await renderFooter();
  const clear = async () => {
    await d.flush();
    const { x, y } = d.point("esc clear");
    await d.mockMouse.click(x, y);
    await d.flush();
  };
  try {
    d.actions.setViewingBranch("feature");
    d.actions.setSearchQuery("Alice");
    d.setSearchInputValue("Alice");
    await clear();
    expect(d.state.searchQuery()).toBe("");
    expect(d.searchInputValue()).toBe("");
    expect(d.clearSearchDebounce).toHaveBeenCalledTimes(1);
    expect(d.state.viewingBranch()).toBe("feature");
    d.actions.setAncestrySet(new Set([commit.hash]));
    await clear();
    expect(d.state.ancestrySet()).toBeNull();
    expect(d.state.viewingBranch()).toBe("feature");
    d.actions.setPathFilter("src");
    d.actions.setPathMatchSet(new Set([commit.hash]));
    await clear();
    expect(d.state.pathFilter()).toBeNull();
    expect(d.state.pathMatchSet()).toBeNull();
    expect(d.state.viewingBranch()).toBe("feature");
    expect(d.loadData).not.toHaveBeenCalled();
    await clear();
    expect(d.state.viewingBranch()).toBeNull();
    expect(d.loadData).toHaveBeenCalledTimes(1);
    expect(d.captureCharFrame()).not.toContain("esc clear");
  } finally {
    d.renderer.destroy();
  }
});

test("footer confirm respects modal routing and escape closes the modal before the underlying filter", async () => {
  const d = await renderFooter();
  try {
    d.setCommandBarMode("path");
    d.setCommandBarValue("new/path");
    d.setDialog("help");
    await d.flush();
    const confirm = d.point("enter confirm");
    await d.mockMouse.click(confirm.x, confirm.y);
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.onPathExecute).not.toHaveBeenCalled();
    expect(d.commandBarMode()).toBe("path");
    d.setCommandBarMode("idle");
    d.actions.setSearchQuery("Alice");
    await d.flush();
    const clear = d.point("esc clear");
    await d.mockMouse.click(clear.x, clear.y, MouseButtons.RIGHT);
    await d.flush();
    expect(d.dialog()).toBe("help");
    await d.mockMouse.click(clear.x, clear.y);
    await d.flush();
    expect(d.dialog()).toBeNull();
    expect(d.state.searchQuery()).toBe("Alice");
    await d.mockMouse.click(clear.x, clear.y);
    await d.flush();
    expect(d.state.searchQuery()).toBe("");
  } finally {
    d.renderer.destroy();
  }
});

test("mouseEnabled false blocks confirm, cancel, back, and clear hover and clicks", async () => {
  const d = await renderFooter();
  const blocked = async (label: string) => {
    await d.flush();
    const { x, y } = d.point(label);
    const before = d.cell(x, y);
    await d.mockMouse.moveTo(x, y);
    await d.flush();
    expect(d.cell(x, y)?.fg).toEqual(before?.fg);
    await d.mockMouse.click(x, y);
    await d.flush();
  };
  try {
    d.setMouseEnabled(false);
    d.setCommandBarMode("search");
    d.setSearchInputValue("Alice");
    await blocked("confirm");
    expect(d.onSearchExecute).not.toHaveBeenCalled();
    await blocked("cancel");
    expect(d.commandBarMode()).toBe("search");
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(d.state.searchQuery()).toBe("Alice");
    openGraphDetails(d.options);
    d.actions.setDetailCursorAction("copy");
    await blocked("copy");
    expect(d.activateCurrentItem).not.toHaveBeenCalled();
    await blocked("back");
    expect(d.state.detailFocused()).toBe(true);
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    expect(d.state.detailFocused()).toBe(false);
    await blocked("clear");
    expect(d.state.searchQuery()).toBe("Alice");
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    expect(d.state.searchQuery()).toBe("");
  } finally {
    d.renderer.destroy();
  }
});
