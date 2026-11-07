import type { GraphRow } from "../git/types";
import type { CopyableField, InteractiveItem } from "../hooks/use-detail-cursor";
import type { StashFileWidths } from "../hooks/use-stash-state";
import type { FileTreeRow } from "../utils/file-tree";
import {
  BADGE_PADDING,
  DIR_INDICATOR_WIDTH,
  ENTRY_PADDING_LEFT,
  HASH_BADGE_GAP,
  SHORT_HASH_LEN,
  STAT_GAP,
  STAT_PADDING_LEFT,
  STATUS_COL_WIDTH,
} from "./detail-types";

/** What the scroll width calculation reads from the detail view. */
export interface CursoredTextSource {
  row: GraphRow | null | undefined;
  getTagForHash: (hash: string) => string | null;
  /** The stash header label, or null when the stash is gone. */
  stashLabel: (stashIndex: number) => string | null;
  stashTreeRows: (stashHash: string) => FileTreeRow[];
  stashFileWidths: (stashHash: string) => StashFileWidths;
  copyableText: (field: CopyableField) => string;
}

/**
 * The text of a cursored Info/Stashes item and how many columns it gets, or null when it fits (or never scrolls,
 * like section headers and the word-wrapped body).
 */
export function cursoredItemText(
  item: InteractiveItem,
  panelWidth: number,
  ctx: CursoredTextSource,
): { text: string; visibleWidth: number } | null {
  switch (item.type) {
    case "section-header":
      return null; // short text, no scroll needed

    case "child":
    case "parent": {
      // Layout: paddingLeft + hash(7) + gap(1) + ` name ` badge
      const r = ctx.row;
      const entryBranch =
        item.type === "child" ? (r?.childBranches[item.index] ?? "") : (r?.parentBranches[item.index] ?? "");
      let name = entryBranch;
      if (name === "") {
        const tag = ctx.getTagForHash(item.hash);
        name = tag ?? "deleted";
      }
      const available = panelWidth - ENTRY_PADDING_LEFT - SHORT_HASH_LEN - HASH_BADGE_GAP - BADGE_PADDING;
      if (name.length <= available) return null;
      return { text: name, visibleWidth: available };
    }

    case "stash-entry": {
      // Header shows only label + optional " (N)" file count suffix.
      // The label is the scrollable part; file count is short and appended outside scroll.
      const label = ctx.stashLabel(item.stashIndex);
      if (label == null) return null;
      const indicatorWidth = 2; // "▸ " or "▾ "
      const available = panelWidth - indicatorWidth;
      if (label.length <= available) return null;
      return { text: label, visibleWidth: available };
    }

    case "stash-dir": {
      // Layout: prefix + connector + dirIndicator + name
      const rows = ctx.stashTreeRows(item.stashHash);
      const treeRow = rows[item.index];
      if (!treeRow) return null;
      const fixedChars = treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
      const available = panelWidth - fixedChars;
      if (treeRow.name.length <= available) return null;
      return { text: treeRow.name, visibleWidth: available };
    }

    case "stash-file": {
      // Layout: prefix + connector + name + stat columns
      const rows = ctx.stashTreeRows(item.stashHash);
      const treeRow = rows[item.index];
      if (!treeRow) return null;
      const fw = ctx.stashFileWidths(item.stashHash);
      const statWidth = STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + fw.addColWidth + STAT_GAP + fw.delColWidth;
      const fixedChars = treeRow.prefix.length + treeRow.connector.length + statWidth;
      const available = panelWidth - fixedChars;
      if (treeRow.name.length <= available) return null;
      return { text: treeRow.name, visibleWidth: available };
    }

    case "copyable": {
      // Body uses wrapMode="word", no banner scroll
      if (item.field === "body") return null;
      const text = ctx.copyableText(item.field);
      const available = panelWidth;
      if (text.length <= available) return null;
      return { text, visibleWidth: available };
    }
  }
}
