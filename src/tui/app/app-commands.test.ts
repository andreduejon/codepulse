import { afterEach, expect, mock, test } from "bun:test";
import { addDebugEvent, clearDebugEvents, getDebugEvents } from "../../core/debug-events";
import type { EventSource } from "../../core/provider-model";
import { createAppState } from "../context/state";
import { type AppCommandContext, runAppCommand } from "./app-commands";
import type { DialogId } from "./ui-state";

afterEach(() => {
  clearDebugEvents();
});

function context(dialog: DialogId = null) {
  const { state, actions } = createAppState();
  let current = dialog;
  const hidden = new Set<EventSource>();
  const ctx = {
    state,
    actions,
    quit: mock(() => {}),
    dialog: () => current,
    setDialog: mock((next: DialogId) => {
      current = next;
    }),
    openCacheScreen: mock(() => {}),
    openRepoSelector: mock(() => {}),
    clearScreenMessage: mock(() => {}),
    setAnchor: mock((_hash: string) => {}),
    clearAnchor: mock(() => {}),
    fetchAll: mock(async () => {}),
    pullAll: mock(async () => {}),
    reloadAll: mock(async () => {}),
    setSearchFocused: mock((_focused: boolean) => {}),
    setSearchInputValue: mock((_value: string) => {}),
    setCommandBarMode: mock((_mode: string) => {}),
    setCommandBarValue: mock((_value: string) => {}),
    toggleDashboardSource: mock((source: EventSource) => {
      if (!hidden.delete(source)) hidden.add(source);
    }),
    hiddenDashboardSources: () => hidden,
  } satisfies AppCommandContext;
  return { ctx, dialog: () => current };
}

test("menu commands open the menu on their tab; unknown commands do nothing", () => {
  const { ctx, dialog } = context();
  runAppCommand(":Providers", ctx);
  expect(ctx.state.menuTab()).toBe("providers");
  expect(dialog()).toBe("menu");
  runAppCommand("nonsense", ctx);
  expect(ctx.setDialog).toHaveBeenCalledTimes(1);
});

test("debug toggles, clear dismisses the banner and Debug, fetch, pull and reload drop ancestry first", () => {
  const { ctx, dialog } = context("debug");
  runAppCommand("debug", ctx);
  expect(dialog()).toBeNull();
  addDebugEvent({ source: "Git", message: "old" });
  runAppCommand("clear", ctx);
  expect(ctx.clearScreenMessage).toHaveBeenCalledTimes(1);
  expect(getDebugEvents()).toHaveLength(0);
  runAppCommand("f", ctx);
  runAppCommand("reload", ctx);
  runAppCommand(":pull", ctx);
  expect(ctx.clearAnchor).toHaveBeenCalledTimes(3);
  expect(ctx.fetchAll).toHaveBeenCalledTimes(1);
  expect(ctx.reloadAll).toHaveBeenCalledTimes(1);
  // :pull fetches and fast-forwards; f only fetches.
  expect(ctx.pullAll).toHaveBeenCalledTimes(1);
});

test("search starts from the active query and path from the active filter", () => {
  const { ctx } = context();
  ctx.actions.setSearchQuery("fix");
  ctx.actions.setPathFilter("src/");
  runAppCommand("search", ctx);
  expect(ctx.setSearchInputValue).toHaveBeenCalledWith("fix");
  expect(ctx.setCommandBarMode).toHaveBeenLastCalledWith("search");
  runAppCommand("path", ctx);
  expect(ctx.setCommandBarValue).toHaveBeenCalledWith("src/");
  expect(ctx.setCommandBarMode).toHaveBeenLastCalledWith("path");
  expect(ctx.setSearchFocused.mock.calls).toEqual([[true], [false]]);
});

test("on the dashboard, the graph's search, path and ancestry commands do nothing", () => {
  const { ctx } = context();
  ctx.actions.setActiveProviderView("dashboard");
  for (const command of ["search", "path", "p", "ancestry", "a"]) runAppCommand(command, ctx);
  expect(ctx.setCommandBarMode).not.toHaveBeenCalled();
  expect(ctx.setSearchFocused).not.toHaveBeenCalled();
  expect(ctx.setAnchor).not.toHaveBeenCalled();
  expect(ctx.clearAnchor).not.toHaveBeenCalled();
  runAppCommand("theme", ctx);
  expect(ctx.setDialog).toHaveBeenCalledWith("theme");
});

test("on the dashboard, :hide and :show hide and show a provider's events, and :show alone shows them all", () => {
  const { ctx } = context();
  const hidden = () => [...ctx.hiddenDashboardSources()].sort();
  // Only the dashboard has provider badges.
  runAppCommand("hide jenkins", ctx);
  expect(hidden()).toEqual([]);

  ctx.actions.setActiveProviderView("dashboard");
  runAppCommand(":hide Jenkins", ctx);
  runAppCommand("hide github", ctx);
  runAppCommand("hide snyk", ctx);
  runAppCommand("hide jenkins", ctx);
  expect(hidden()).toEqual(["github-actions", "jenkins", "snyk"]);
  runAppCommand("show github", ctx);
  expect(hidden()).toEqual(["jenkins", "snyk"]);
  // A name it doesn't know changes nothing.
  runAppCommand("hide gitlab", ctx);
  expect(hidden()).toEqual(["jenkins", "snyk"]);
  runAppCommand("show", ctx);
  expect(hidden()).toEqual([]);
});
