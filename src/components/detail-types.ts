import type { KeyEvent, Renderable } from "@opentui/core";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../constants";
import type { DiffTarget } from "../git/types";
import type { ProviderDetailSources } from "../providers/detail-entries";
import type { FileTreeRow } from "../utils/file-tree";

/** Mutable ref populated by a detail view for app.tsx to call */
export interface DetailNavRef {
  /** Number of interactive items currently visible */
  itemCount: number;
  /** Activate the item at the current cursor index. Returns true if it was a jump-to-commit action. */
  activateCurrentItem: () => boolean;
  /** Direction of the last jump: "child" means we selected a child entry, "parent" means we selected a parent entry */
  lastJumpFrom: "child" | "parent" | null;
  /** Pending jump direction — persists across interactiveItems recomputations.
   *  Set by handleJumpToCommit, cleared by app.tsx commit-change effect on non-jump navigation. */
  pendingJumpDirection: "child" | "parent" | null;
  /** Move the detail cursor to the file with the given path (if visible in the current tab). */
  scrollToFile: (filePath: string) => void;
  /** Element refs for all interactive items, indexed by item position in the flat list. */
  itemRefs: Renderable[];
  /** Coalesced scroll-into-view timer for fast cursor movement. */
  scrollTimer?: ReturnType<typeof setTimeout>;
  /** Row shortcuts of the active tab (e.g. `v` on a vulnerable dependency); true when handled. */
  handleKey?: (event: KeyEvent) => boolean;
  /** Native detail-filter input owns typing before app shortcuts run. */
  handleFilterKey?: (event: KeyEvent) => boolean;
  /** Reveal the current row after a filter or scan resets its cursor. */
  scrollToCursor?: () => void;
}

export interface DetailViewProps {
  contentWidth?: number;
  /** Opt-in for detail row mouse actions, reactive to modal ownership. */
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  onJumpToCommit?: (hash: string, from: "child" | "parent") => void;
  /** Open the diff+blame dialog for a file. */
  onOpenDiff?: (target: DiffTarget) => void;
  /** Mutable ref object populated by the detail view with navigation callbacks */
  navRef?: DetailNavRef;
  /** What each provider hands its detail tabs (see `providers/detail-entries.ts`). */
  providers?: Partial<ProviderDetailSources>;
}

/** Layout constants shared between committed and uncommitted detail views */
/** Horizontal padding (paddingX=2 each side) subtracted from panel width. */
export const PANEL_PADDING_X = 4;
/** Width of the abbreviated commit hash (7 hex chars). */
export const SHORT_HASH_LEN = 7;
/** Space between hash and badge in child/parent entry rows. */
export const HASH_BADGE_GAP = 1;
/** Badge inner padding (1 space each side of the text). */
export const BADGE_PADDING = 2;
/** Left indent for child/parent/file entry rows. */
export const ENTRY_PADDING_LEFT = 2;
/** Width of the directory collapse indicator ("▸ " / "▾ "). */
export const DIR_INDICATOR_WIDTH = 2;
/** Padding before the status letter in file rows. */
export const STAT_PADDING_LEFT = 1;
/** Width of the status letter column (padding + letter). */
export const STATUS_COL_WIDTH = 2;
/** Padding between the stat columns (status→+, +→-). */
export const STAT_GAP = 1;

const MIN_DETAIL_PANEL_WIDTH = 60;

/**
 * Usable columns inside the detail panel: the compact dialog passes its exact content width; the sidebar is a share
 * of the terminal. Every detail tab uses this, so selected text scrolls within the same width in both layouts.
 */
export function detailUsableWidth(contentWidth: number | undefined, terminalWidth: number): number {
  return (
    contentWidth ??
    Math.max(Math.floor(terminalWidth * DETAIL_PANEL_WIDTH_FRACTION), MIN_DETAIL_PANEL_WIDTH) - PANEL_PADDING_X
  );
}

/**
 * The cursored file-tree row's name and visible width when the name does not fit (it then banner-scrolls), else
 * null. Shared by the committed Files tab and the working-tree tabs.
 */
export function fileRowOverflow(
  row: FileTreeRow,
  panelWidth: number,
  widths: { addColWidth: number; delColWidth: number },
  hideStats = false,
): { text: string; visibleWidth: number } | null {
  const statWidth = row.isDir
    ? DIR_INDICATOR_WIDTH
    : hideStats
      ? STAT_PADDING_LEFT + STATUS_COL_WIDTH
      : STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + widths.addColWidth + STAT_GAP + widths.delColWidth;
  const available = panelWidth - row.prefix.length - row.connector.length - statWidth;
  return row.name.length <= available ? null : { text: row.name, visibleWidth: available };
}

/** Compute column widths for file change stats (total determines column width). */
export function computeFileWidths(files: readonly { additions: number; deletions: number }[]) {
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);
  return {
    totalAdd,
    totalDel,
    addColWidth: `+${totalAdd}`.length,
    delColWidth: `-${totalDel}`.length,
  };
}
