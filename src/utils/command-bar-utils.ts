/**
 * Pure helper functions extracted from command-bar.tsx.
 *
 * These functions are framework-agnostic and unit-testable without SolidJS
 * or opentui dependencies.
 */
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";

type HighlightMode = "search" | "path" | "ancestry" | null;

/**
 * Derive the placeholder text for the command bar input based on the current mode.
 */
export function commandBarPlaceholder(mode: CommandBarMode): string {
  switch (mode) {
    case "command":
      return "Enter command...";
    case "search":
      return "Search commits...";
    case "path":
      return "Enter path...";
    default:
      return "";
  }
}

/**
 * Derive the visible value of the command bar input.
 *
 * - In command/path mode: show the raw command bar value.
 * - In search mode: show the search input value.
 * - In idle mode: show the active filter value if a highlight is active.
 */
export function commandBarInputValue(opts: {
  commandBarMode: CommandBarMode;
  commandBarValue: string;
  searchInputValue: string;
  highlightMode: HighlightMode;
  pathFilter: string | null;
}): string {
  const { commandBarMode, commandBarValue, searchInputValue, highlightMode, pathFilter } = opts;
  if (commandBarMode === "command") return commandBarValue;
  if (commandBarMode === "path") return commandBarValue;
  if (commandBarMode === "search") return searchInputValue;
  // Idle: reflect the active filter
  if (highlightMode === "search") return searchInputValue;
  if (highlightMode === "path") return pathFilter ?? "";
  return "";
}

/**
 * Derive the mode badge label shown in the status row.
 *
 * - When the command bar is actively open, show the active bar mode.
 * - When idle, show the active highlight mode (or "normal").
 */
export function modeBadgeLabel(commandBarMode: CommandBarMode, highlightMode: HighlightMode): string {
  if (commandBarMode === "command") return " command ";
  if (commandBarMode === "search") return " search ";
  if (commandBarMode === "path") return " path ";
  if (highlightMode === "search") return " search ";
  if (highlightMode === "path") return " path ";
  if (highlightMode === "ancestry") return " ancestry ";
  return " normal ";
}

/**
 * Derive the commit count display text.
 *
 * - When a highlight is active: "matchCount / totalCount"
 * - Otherwise: "totalCount"
 */
export function commitCountText(highlightSet: Set<string> | null, totalRows: number): string {
  return highlightSet !== null ? `${highlightSet.size} / ${totalRows}` : `${totalRows}`;
}
