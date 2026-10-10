import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal } from "solid-js";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import { buildGraph } from "../git/graph";
import type { Commit } from "../git/types";
import { type GraphKeyOptions, handleGraphKey, openGraphDetails } from "../hooks/handle-graph-keys";
import type { DialogId } from "../hooks/use-keyboard-navigation";
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
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: "parent",
    scrollToFile: () => {},
    itemRefs: [],
  };
  let app!: ReturnType<typeof createAppState>;
  let options!: GraphKeyOptions;
  const onOpenDetails = mock(() => openGraphDetails(options));
  const keyResult = mock((_consumed: boolean, _prevented: boolean) => {});
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
        onCommandExecute: () => {},
        setCommandBarMode: () => {},
        setCommandBarValue: () => {},
      };
      useKeyboard(event => keyResult(handleGraphKey(event, options), event.defaultPrevented));
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <box width="100%" height={2} flexDirection="column">
              <Footer
                commandBarMode={() => "idle"}
                compact={layoutMode() !== "normal"}
                mouseEnabled={mouseEnabled()}
                onOpenDetails={onOpenDetails}
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
    expect(d.keyResult).toHaveBeenLastCalledWith(false, false);
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
    expect(d.keyResult).toHaveBeenLastCalledWith(true, true);
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
    expect(d.keyResult).toHaveBeenLastCalledWith(false, false);
    d.expectClosed();
  } finally {
    d.renderer.destroy();
  }
});

test("normal footer show-details hint does not invoke the mouse action", async () => {
  const d = await renderFooter();
  try {
    d.setLayoutMode("normal");
    await d.flush();
    for (const label of ["enter/→", "show details"]) {
      const { x, y } = d.point(label);
      const before = d.cell(x, y);
      await d.mockMouse.moveTo(x, y);
      await d.flush();
      expect(d.cell(x, y)?.fg).toEqual(before?.fg);
      await d.mockMouse.click(x, y);
      await d.flush();
      d.expectClosed();
    }
    expect(d.onOpenDetails).not.toHaveBeenCalled();
  } finally {
    d.renderer.destroy();
  }
});
