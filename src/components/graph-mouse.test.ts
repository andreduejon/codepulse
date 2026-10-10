import { expect, test } from "bun:test";
import { RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createComponent } from "solid-js";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext, themes } from "../context/theme";
import { buildGraph } from "../git/graph";
import type { Commit } from "../git/types";
import GraphView from "./graph";

test("graph wheel preserves selection; left click selects; modal blocks mouse", async () => {
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
  let mouseEnabled = true;
  let loads = 0;
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      const commits: Commit[] = Array.from({ length: 30 }, (_, index) => ({
        hash: `${index}`,
        shortHash: `${index}`,
        parents: index < 29 ? [`${index + 1}`] : [],
        subject: `Commit ${index}`,
        body: "",
        author: "Author",
        authorEmail: "author@example.com",
        authorDate: "2026-01-01T00:00:00Z",
        committer: "Author",
        committerEmail: "author@example.com",
        commitDate: "2026-01-01T00:00:00Z",
        refs: [],
      }));
      app.actions.setGraphRows(buildGraph(commits));
      app.actions.setCommits(commits);
      app.actions.setLoading(false);
      app.actions.setHasMore(false);
      return createComponent(ThemeContext.Provider, {
        value: createThemeState(),
        get children() {
          return createComponent(AppStateContext.Provider, {
            value: app,
            get children() {
              return createComponent(GraphView, {
                scrollboxRef: el => {
                  scrollbox = el;
                },
                mouseEnabled: () => mouseEnabled,
                onLoadMore: () => {
                  loads++;
                  app.actions.setFetching(true);
                },
                onSelectRow: index => {
                  app.actions.setDetailFocused(false);
                  app.actions.setCursorIndex(index);
                  app.actions.setScrollTargetIndex(index);
                },
              });
            },
          });
        },
      });
    },
    { width: 200, height: 10, useMouse: true, enableMouseMovement: true },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Commit 0");
    const selected = app.state.selectedCommit();
    const detail = selected && { ...selected, files: [] };
    app.actions.setCommitDetail(detail);
    const subjectSpan = (line: number) =>
      setup.captureSpans().lines[line]?.spans.find(span => span.text.includes("Commit"));
    const beforeHover = subjectSpan(2);
    expect(beforeHover).toBeDefined();
    await setup.mockMouse.moveTo(30, 2);
    await setup.renderOnce();
    const hovered = subjectSpan(2);
    expect(hovered?.bg).toEqual(RGBA.fromHex(themes["catppuccin-mocha"].backgroundElement));
    expect(hovered?.fg).toEqual(beforeHover?.fg);
    expect(hovered?.attributes).toBe(beforeHover?.attributes);
    expect(app.state.selectedCommit()).toBe(selected);
    expect(app.state.commitDetail()).toBe(detail);
    await setup.mockMouse.moveTo(30, 3); // connector row belongs to the same commit block
    await setup.renderOnce();
    expect(subjectSpan(2)?.bg).toEqual(hovered?.bg);
    await setup.mockMouse.click(30, 3);
    expect(app.state.cursorIndex()).toBe(1);
    app.actions.setCursorIndex(0);
    app.actions.setScrollTargetIndex(0);
    await setup.mockMouse.moveTo(30, 8);
    await setup.renderOnce();
    expect(subjectSpan(2)?.bg).toEqual(beforeHover?.bg);
    await new Promise(resolve => setTimeout(resolve, 25));
    await setup.mockMouse.scroll(30, 3, "down");
    await new Promise(resolve => setTimeout(resolve, 25));
    await setup.renderOnce();
    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(app.state.selectedCommit()).toBe(selected);
    expect(app.state.commitDetail()).toBe(detail);
    const visibleIndex = Number(
      setup
        .captureCharFrame()
        .split("\n")[3]
        ?.match(/Commit (\d+)/)?.[1],
    );
    expect(Number.isFinite(visibleIndex)).toBe(true);
    app.actions.setDetailFocused(true);
    await setup.mockMouse.click(30, 3, MouseButtons.RIGHT);
    expect(app.state.selectedCommit()).toBe(selected);
    await setup.mockMouse.click(30, 3);
    expect(app.state.cursorIndex()).toBe(visibleIndex);
    expect(app.state.detailFocused()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 25));
    await setup.renderOnce();
    mouseEnabled = false;
    const top = scrollbox.scrollTop;
    await setup.mockMouse.scroll(30, 3, "down");
    await setup.mockMouse.click(30, 4);
    expect(scrollbox.scrollTop).toBe(top);
    expect(app.state.cursorIndex()).toBe(visibleIndex);
    app.actions.moveCursor(1);
    expect(app.state.cursorIndex()).toBe(visibleIndex + 1);

    // Wheel pagination is viewport-driven, not selection-driven.
    await new Promise(resolve => setTimeout(resolve, 25));
    mouseEnabled = true;
    app.actions.setHasMore(true);
    const pointer = app.state.selectedCommit();
    const target = app.state.scrollTargetIndex();
    scrollbox.scrollTo(0);
    await setup.renderOnce();
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(0);
    scrollbox.scrollTo(scrollbox.scrollHeight - scrollbox.viewport.height - 5);
    await setup.renderOnce();
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(1);
    expect(app.state.selectedCommit()).toBe(pointer);
    expect(app.state.scrollTargetIndex()).toBe(target);
    expect(app.state.commitDetail()).toBe(detail);
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(1); // in-flight request blocks duplicate fetches

    const oldCommits = app.state.commits();
    const nextPage = oldCommits.map((commit, index) => ({
      ...commit,
      hash: `${30 + index}`,
      shortHash: `${30 + index}`,
      subject: `Commit ${30 + index}`,
      parents: index < 29 ? [`${31 + index}`] : [],
    }));
    const topBeforeAppend = scrollbox.scrollTop;
    app.actions.setGraphRows(buildGraph([...oldCommits, ...nextPage]));
    app.actions.setFetching(false);
    await setup.renderOnce();
    expect(scrollbox.scrollTop).toBe(topBeforeAppend);
    expect(app.state.selectedCommit()).toBe(pointer);
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(1);
    scrollbox.scrollTo(scrollbox.scrollHeight);
    await setup.renderOnce();
    mouseEnabled = false;
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(1);
    mouseEnabled = true;
    app.actions.setHasMore(false);
    await setup.mockMouse.scroll(30, 3, "down");
    expect(loads).toBe(1); // exhausted history does not fetch again
  } finally {
    setup.renderer.destroy();
  }
});
