import { setLastMenuTab } from "./components/dialogs/menu-dialog";
import type { AppActions, AppState } from "./context/app-state-types";
import { clearDebugEvents } from "./debug/events";
import type { CommandBarMode, DialogId } from "./hooks/use-keyboard-navigation";

/** What `:` commands can reach in the app. */
export interface AppCommandContext {
  state: AppState;
  actions: AppActions;
  quit: () => void;
  dialog: () => DialogId;
  setDialog: (dialog: DialogId) => void;
  openCacheScreen: () => void;
  openRepoSelector: () => void;
  clearScreenMessage: () => void;
  setAnchor: (hash: string) => void;
  clearAnchor: () => void;
  fetchAll: () => Promise<void>;
  reloadAll: () => Promise<void>;
  setSearchFocused: (focused: boolean) => void;
  setSearchInputValue: (value: string) => void;
  setCommandBarMode: (mode: CommandBarMode) => void;
  setCommandBarValue: (value: string) => void;
}

/**
 * Execute a command dispatched from the command bar.
 * Receives the trimmed value entered after `:` (e.g. "q", "quit", "m", "search").
 */
export function runAppCommand(cmd: string, ctx: AppCommandContext): void {
  const normalized = cmd.toLowerCase().replace(/^:/, "");

  switch (normalized) {
    case "cache":
      ctx.openCacheScreen();
      break;
    case "q":
    case "quit":
      ctx.quit();
      break;
    case "m":
    case "menu":
      ctx.setDialog("menu");
      break;
    case "repo":
      setLastMenuTab("repository");
      ctx.setDialog("menu");
      break;
    case "branches":
      setLastMenuTab("branch");
      ctx.setDialog("menu");
      break;
    case "providers":
      setLastMenuTab("providers");
      ctx.setDialog("menu");
      break;
    case "switch":
      ctx.openRepoSelector();
      break;
    case "help":
      ctx.setDialog("help");
      break;
    case "theme":
      ctx.setDialog("theme");
      break;
    case "debug":
      ctx.setDialog(ctx.dialog() === "debug" ? null : "debug");
      break;
    case "clear":
      ctx.clearScreenMessage();
      clearDebugEvents();
      break;
    case "f":
    case "fetch":
      ctx.clearAnchor();
      void ctx.fetchAll();
      break;
    case "r":
    case "reload":
      ctx.clearAnchor();
      void ctx.reloadAll();
      break;
    case "search":
    case "p":
    case "path":
      ctx.actions.setDetailFocused(false);
      ctx.setSearchFocused(normalized === "search");
      if (normalized === "search") {
        ctx.setSearchInputValue(ctx.state.searchQuery());
        ctx.setCommandBarMode("search");
      } else {
        ctx.setCommandBarValue(ctx.state.pathFilter() ?? "");
        ctx.setCommandBarMode("path");
      }
      break;
    case "a":
    case "ancestry": {
      // Toggle ancestry mode — highlights the first-parent chain through the
      // selected commit (both backward ancestors and forward descendants).
      if (ctx.state.ancestrySet() !== null) {
        // Already active — toggle off
        ctx.clearAnchor();
        break;
      }
      // Mutually exclusive with search and path
      ctx.actions.setSearchQuery("");
      ctx.actions.setPathFilter(null);
      ctx.actions.setPathMatchSet(null);
      const anchor = ctx.state.selectedCommit()?.hash ?? null;
      if (anchor) {
        ctx.setAnchor(anchor);
      }
      break;
    }
    default:
      // Unknown command — ignore silently
      break;
  }
}
