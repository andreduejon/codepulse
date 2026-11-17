/**
 * The command bar: its mode (`:` commands, `/` search, path), what is typed in it, and the graph's highlight modes it
 * switches between (normal, search, path, ancestry). Running a `:` command is the app's (it reaches everything), so it
 * comes in as `runCommand`.
 */

import { type Accessor, batch, createSignal } from "solid-js";
import type { AppActions, AppState } from "../context/state";
import type { CommandBarMode } from "../core/app-state";
import type { GitPort } from "../core/git/port";
import { computeDisplacedIndex } from "../core/navigation";
import { usePathFilter } from "../hooks/use-path-filter";

export type GraphMode = "normal" | "search" | "path" | "ancestry";

export function useCommandBar(opts: {
  state: AppState;
  actions: AppActions;
  repoPath: Accessor<string>;
  /** Git, through the app's port. */
  git: GitPort;
  clearAnchor: () => void;
  runCommand: (command: string) => void;
}) {
  const { state, actions, clearAnchor } = opts;
  const [searchFocused, setSearchFocused] = createSignal(false);
  /** What is typed in the search bar: independent of the applied filter, which changes on Enter. */
  const [searchInputValue, setSearchInputValue] = createSignal("");
  /** Command bar mode: drives the placeholder text and where keys go. */
  const [commandBarMode, setCommandBarMode] = createSignal<CommandBarMode>("idle");
  /** What is typed after `:` or in path mode (`search`, `path src/`). */
  const [commandBarValue, setCommandBarValue] = createSignal("");

  // Path mode: applies on Enter, and is worked out again as the graph changes.
  const { handlePathExecute } = usePathFilter({
    repoPath: opts.repoPath,
    git: opts.git,
    state,
    actions,
    clearAnchor,
    setSearchInputValue,
    clearSearchDebounce: () => {},
  });

  /** Leaves the command bar: nothing focused, nothing half typed. */
  const leave = () => {
    setSearchFocused(false);
    setCommandBarMode("idle");
    setCommandBarValue("");
  };

  return {
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    leave,
    /** Closes search and path input (the Dashboard has neither); a `:` command being typed stays. */
    closeSearch: () => {
      const mode = commandBarMode();
      if (mode === "search" || mode === "path") leave();
    },
    /** What the command bar's input shows as it is typed in. */
    onInput: (value: string) => {
      const mode = commandBarMode();
      if (mode === "command" || mode === "path") setCommandBarValue(value);
      else setSearchInputValue(value);
    },
    handlePathExecute,
    /** A click on a mode badge: search and path open their input; normal and ancestry apply at once. */
    selectMode: (mode: GraphMode) => {
      if (mode === "search" || mode === "path") {
        opts.runCommand(mode);
        return;
      }
      batch(() => {
        leave();
        setSearchInputValue("");
        actions.setSearchQuery("");
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        if (mode === "normal") clearAnchor();
        else opts.runCommand("ancestry");
      });
    },
    /** Enter in search: the query highlights, and the cursor moves to a highlighted commit. */
    applySearch: (value: string) => {
      batch(() => {
        clearAnchor();
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        setSearchInputValue(value);
        actions.setSearchQuery(value);
      });
      const target = computeDisplacedIndex(state.graphRows(), state.highlightSet(), state.cursorIndex());
      actions.setCursorIndex(target);
      actions.setScrollTargetIndex(target);
    },
  };
}
