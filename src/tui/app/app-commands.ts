import { clearDebugEvents } from "../../core/debug-events";
import { toggleAncestry } from "../../core/highlights";
import type { EventSource } from "../../core/provider-model";
import type { AppActions, AppState } from "../context/state";
import type { CommandBarMode, DialogId } from "./ui-state";

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
  /** Fetch, then fast-forward the branches that are only behind (ctrl+f, `:pull`). */
  pullAll: () => Promise<void>;
  reloadAll: () => Promise<void>;
  setSearchFocused: (focused: boolean) => void;
  setSearchInputValue: (value: string) => void;
  setCommandBarMode: (mode: CommandBarMode) => void;
  setCommandBarValue: (value: string) => void;
  /** The dashboard's provider badges: a click hides or shows that provider's events. */
  toggleDashboardSource: (source: EventSource) => void;
  hiddenDashboardSources: () => ReadonlySet<EventSource>;
}

/** The source `:hide` and `:show` name: `git`, or a provider by its settings key, as the badges read (`github`). */
function dashboardSource(name: string, ctx: AppCommandContext): EventSource | undefined {
  if (name === "git") return "git";
  return ctx.state.providers.set.byKey(name)?.id;
}

/** `:hide NAME`, `:show NAME`, `:show`: what a badge click does, from the keyboard. Dashboard only. */
function runSourceCommand(verb: "hide" | "show", name: string | undefined, ctx: AppCommandContext): void {
  if (ctx.state.activeProviderView() !== "dashboard") return;
  const hidden = ctx.hiddenDashboardSources();
  if (verb === "show" && name === undefined) {
    for (const source of [...hidden]) ctx.toggleDashboardSource(source);
    return;
  }
  const source = name === undefined ? undefined : dashboardSource(name, ctx);
  if (source && hidden.has(source) !== (verb === "hide")) ctx.toggleDashboardSource(source);
}

/**
 * Execute a command dispatched from the command bar.
 * Receives the trimmed value entered after `:` (e.g. "q", "quit", "m", "search").
 */
/** Commands that act on the graph: the dashboard has none of it behind it, so they do nothing there. */
const GRAPH_COMMANDS: ReadonlySet<string> = new Set(["search", "p", "path", "a", "ancestry"]);

export function runAppCommand(cmd: string, ctx: AppCommandContext): void {
  const normalized = cmd.toLowerCase().replace(/^:/, "");
  if (ctx.state.activeProviderView() === "dashboard" && GRAPH_COMMANDS.has(normalized)) return;
  const [verb, name, ...rest] = normalized.trim().split(/\s+/);
  if ((verb === "hide" || verb === "show") && rest.length === 0) {
    runSourceCommand(verb, name, ctx);
    return;
  }

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
      ctx.actions.setMenuTab("repository");
      ctx.setDialog("menu");
      break;
    case "branches":
      ctx.actions.setMenuTab("branch");
      ctx.setDialog("menu");
      break;
    case "providers":
      ctx.actions.setMenuTab("providers");
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
    case "pull":
      ctx.clearAnchor();
      void ctx.pullAll();
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
    case "ancestry":
      toggleAncestry(ctx);
      break;
    default:
      // Unknown command — ignore silently
      break;
  }
}
