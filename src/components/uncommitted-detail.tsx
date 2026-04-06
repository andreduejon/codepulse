import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, For, Show } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../constants";
import { useAppState } from "../context/state";
import type { DiffSource } from "../git/types";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { useFileTree } from "../hooks/use-file-tree";
import { useT } from "../hooks/use-t";
import { isCursored as _isCursored, itemHighlightBg as _itemHighlightBg } from "../utils/detail-cursor";
import type { DetailViewProps } from "./detail-types";
import {
  computeFileWidths,
  DIR_INDICATOR_WIDTH,
  PANEL_PADDING_X,
  STAT_GAP,
  STAT_PADDING_LEFT,
  STATUS_COL_WIDTH,
} from "./detail-types";
import { FileTreeEntry } from "./file-tree-entry";
import { TotalLinesChangedRow } from "./total-lines-changed-row";

// ── Layout constants ────────────────────────────────────────────────
const MIN_PANEL_WIDTH = 60;

/** Interactive item types for the uncommitted detail panel (file trees only) */
type UncommittedItem =
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string; index: number };

export default function UncommittedDetailView(props: Readonly<DetailViewProps>) {
  const { state, actions } = useAppState();
  const t = useT();
  const dimensions = useTerminalDimensions();

  const panelUsableWidth = () =>
    Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X;

  // Active tab for uncommitted node: "staged" | "unstaged" | "untracked"
  const activeTab = () => state.detailActiveTab();

  // Get files for the active tab from uncommittedDetail
  const activeFiles = createMemo(() => {
    const ud = state.uncommittedDetail();
    if (!ud) return [];
    const tab = activeTab();
    if (tab === "staged") return ud.staged;
    if (tab === "unstaged") return ud.unstaged;
    if (tab === "untracked") return ud.untracked;
    return [];
  });

  // File widths for the active tab
  const fileWidths = createMemo(() => {
    const files = activeFiles();
    if (files.length === 0) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    return computeFileWidths(files);
  });

  // File tree state — resets collapsed dirs when active tab changes
  const { fileTreeRows, collapsedDirs, toggleDir } = useFileTree(activeFiles, activeTab);

  // ── Build flat list of interactive items ──
  const interactiveItems = createMemo((): UncommittedItem[] => {
    const rows = fileTreeRows();
    const items: UncommittedItem[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.isDir) {
        items.push({ type: "file-dir", dirPath: row.dirPath, index: i });
      } else {
        items.push({ type: "file", filePath: row.file?.path, index: i });
      }
    }
    return items;
  });

  // Clamp cursor when interactive items change
  createEffect(() => {
    const count = interactiveItems().length;
    const cursor = state.detailCursorIndex();
    if (count === 0) {
      actions.setDetailCursorIndex(0);
    } else if (cursor >= count) {
      actions.setDetailCursorIndex(count - 1);
    }
  });

  /** Execute the action for the given item */
  const activateItem = (item: UncommittedItem) => {
    if (item.type === "file-dir") {
      toggleDir(item.dirPath);
    } else if (item.type === "file" && props.onOpenDiff && item.filePath) {
      const source = activeTab() as DiffSource;
      const fileList = activeFiles().map(f => f.path);
      const fileIndex = fileList.indexOf(item.filePath);
      const clampedIdx = Math.max(0, fileIndex);
      const fileStatus = activeFiles()[clampedIdx]?.status;
      props.onOpenDiff({
        commitHash: "",
        filePath: item.filePath,
        source,
        status: fileStatus,
        fileList,
        fileIndex: clampedIdx,
      });
    }
  };

  /** Activate the item at the current cursor index. Returns true if it was a jump. */
  const activateCurrentItem = (): boolean => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx >= 0 && idx < items.length) {
      activateItem(items[idx]);
    }
    return false; // no jump-to-commit in uncommitted view
  };

  // Keep navRef updated
  createEffect(() => {
    if (props.navRef) {
      props.navRef.itemCount = interactiveItems().length;
      props.navRef.activateCurrentItem = activateCurrentItem;
      props.navRef.scrollToFile = (filePath: string) => {
        const rows = fileTreeRows();
        const treeIdx = rows.findIndex(r => !r.isDir && r.file?.path === filePath);
        if (treeIdx >= 0) {
          const itemIdx = findItemIndex("file", treeIdx);
          if (itemIdx >= 0) actions.setDetailCursorIndex(itemIdx);
        }
      };
    }
  });

  // Keep footer hint in sync
  createEffect(() => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (!state.detailFocused() || idx < 0 || idx >= items.length) {
      actions.setDetailCursorAction(null);
      return;
    }
    const item = items[idx];
    if (item.type === "file-dir") {
      actions.setDetailCursorAction(collapsedDirs().has(item.dirPath) ? "expand" : "collapse");
    } else {
      actions.setDetailCursorAction("diff");
    }
  });

  // ── Banner scroll ──────────────────────────────────────────────────

  /** Memo'd index map for O(1) lookup */
  const itemIndexMap = createMemo(() => {
    const map = new Map<string, number>();
    const items = interactiveItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      map.set(`${item.type}:${item.index}`, i);
    }
    return map;
  });

  const findItemIndex = (type: "file-dir" | "file", idx: number): number => itemIndexMap().get(`${type}:${idx}`) ?? -1;

  const isCursored = (itemIndex: number) => _isCursored(state, itemIndex);
  const itemHighlightBg = (itemIndex: number): string | undefined => _itemHighlightBg(state, t(), itemIndex);

  const cursoredTextInfo = createMemo((): { text: string; visibleWidth: number } | null => {
    if (!state.detailFocused()) return null;
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx < 0 || idx >= items.length) return null;

    const item = items[idx];
    const pw = panelUsableWidth();
    const rows = fileTreeRows();
    const treeRow = rows[item.index];
    if (!treeRow) return null;

    if (item.type === "file-dir") {
      const fixedChars = treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
      const available = pw - fixedChars;
      if (treeRow.name.length <= available) return null;
      return { text: treeRow.name, visibleWidth: available };
    }

    if (item.type === "file") {
      const fw = fileWidths();
      const statWidth =
        activeTab() === "untracked"
          ? STAT_PADDING_LEFT + STATUS_COL_WIDTH
          : STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + fw.addColWidth + STAT_GAP + fw.delColWidth;
      const fixedChars = treeRow.prefix.length + treeRow.connector.length + statWidth;
      const available = pw - fixedChars;
      if (treeRow.name.length <= available) return null;
      return { text: treeRow.name, visibleWidth: available };
    }

    return null;
  });

  // Must be after cursoredTextInfo (TDZ safety)
  const bannerOverflow = createMemo(() => {
    const info = cursoredTextInfo();
    if (!info) return 0;
    return Math.max(0, info.text.length - info.visibleWidth);
  });
  const bannerOffset = useBannerScroll(bannerOverflow);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show
        when={activeFiles().length > 0}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>{state.detailLoading() ? "Loading..." : `No ${activeTab()} files`}</text>
          </box>
        }
      >
        {/* Total lines changed (skip for untracked which have 0/0 stats) */}
        <Show when={activeTab() !== "untracked" && (fileWidths().totalAdd > 0 || fileWidths().totalDel > 0)}>
          <TotalLinesChangedRow totalAdd={fileWidths().totalAdd} totalDel={fileWidths().totalDel} />
        </Show>

        <For each={fileTreeRows()}>
          {(treeRow, i) => {
            const itemIdx = () => findItemIndex(treeRow.isDir ? "file-dir" : "file", i());
            const cursored = () => isCursored(itemIdx());
            const collapsed = () => treeRow.isDir && collapsedDirs().has(treeRow.dirPath);

            const scrolledName = () => {
              if (!cursored()) return null;
              const info = cursoredTextInfo();
              if (!info || info.text !== treeRow.name) return null;
              const off = bannerOffset();
              return treeRow.name.substring(off, off + info.visibleWidth);
            };

            return (
              <FileTreeEntry
                row={treeRow}
                cursored={cursored()}
                collapsed={collapsed()}
                highlightBg={itemHighlightBg(itemIdx())}
                scrolledName={scrolledName()}
                addColWidth={fileWidths().addColWidth}
                delColWidth={fileWidths().delColWidth}
                hideStats={activeTab() === "untracked"}
              />
            );
          }}
        </For>
      </Show>
    </box>
  );
}
