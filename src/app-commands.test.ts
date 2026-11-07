import { afterEach, expect, mock, test } from "bun:test";
import { type AppCommandContext, runAppCommand } from "./app-commands";
import { lastMenuTab, setLastMenuTab } from "./components/dialogs/menu-dialog";
import { createAppState } from "./context/state";
import { addDebugEvent, clearDebugEvents, getDebugEvents } from "./debug/events";
import type { DialogId } from "./hooks/use-keyboard-navigation";

afterEach(() => {
  setLastMenuTab("repository");
  clearDebugEvents();
});

function context(dialog: DialogId = null) {
  const { state, actions } = createAppState();
  let current = dialog;
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
    reloadAll: mock(async () => {}),
    setSearchFocused: mock((_focused: boolean) => {}),
    setSearchInputValue: mock((_value: string) => {}),
    setCommandBarMode: mock((_mode: string) => {}),
    setCommandBarValue: mock((_value: string) => {}),
  } satisfies AppCommandContext;
  return { ctx, dialog: () => current };
}

test("menu commands open the menu on their tab; unknown commands do nothing", () => {
  const { ctx, dialog } = context();
  runAppCommand(":Providers", ctx);
  expect(lastMenuTab()).toBe("providers");
  expect(dialog()).toBe("menu");
  runAppCommand("nonsense", ctx);
  expect(ctx.setDialog).toHaveBeenCalledTimes(1);
});

test("debug toggles, clear dismisses the banner and Debug, fetch and reload drop ancestry first", () => {
  const { ctx, dialog } = context("debug");
  runAppCommand("debug", ctx);
  expect(dialog()).toBeNull();
  addDebugEvent({ source: "Git", message: "old" });
  runAppCommand("clear", ctx);
  expect(ctx.clearScreenMessage).toHaveBeenCalledTimes(1);
  expect(getDebugEvents()).toHaveLength(0);
  runAppCommand("f", ctx);
  runAppCommand("reload", ctx);
  expect(ctx.clearAnchor).toHaveBeenCalledTimes(2);
  expect(ctx.fetchAll).toHaveBeenCalledTimes(1);
  expect(ctx.reloadAll).toHaveBeenCalledTimes(1);
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
