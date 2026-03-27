import { Show, For, createSignal, createEffect, createMemo } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import { buildFileTree, flattenFileTree } from "../utils/file-tree";
import type { FileTreeNode, FileTreeRow } from "../utils/file-tree";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../constants";
import type { DetailNavRef, DetailViewProps } from "./detail-types";
import {
  PANEL_PADDING_X, ENTRY_PADDING_LEFT, DIR_INDICATOR_WIDTH,
  STAT_PADDING_LEFT, STATUS_COL_WIDTH, STAT_GAP, computeFileWidths,
} from "./detail-types";

// ── Layout constants ────────────────────────────────────────────────
const MIN_PANEL_WIDTH = 60;

/** Interactive item types for the uncommitted detail panel (file trees only) */
type UncommittedItem =
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string; index: number };

export default function UncommittedDetailView(props: Readonly<DetailViewProps>) {
  const { state, actions } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();
  const renderer = useRenderer();

  const panelUsableWidth = () =>
    Math.max(Math.floor(renderer.width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X;

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

  // Build file tree from flat file paths
  const fileTree = createMemo((): FileTreeNode => {
    const files = activeFiles();
    if (files.length === 0) return { name: "/", fullPath: "/", children: [] };
    return buildFileTree(files);
  });

  // Collapsed directory paths (tracked by fullPath)
  const [collapsedDirs, setCollapsedDirs] = createSignal(new Set<string>());

  // Reset collapsed dirs when tab changes
  createEffect(() => {
    activeTab();
    setCollapsedDirs(new Set<string>());
  });

  const toggleDir = (dirPath: string) => {
    const next = new Set(collapsedDirs());
    if (next.has(dirPath)) next.delete(dirPath);
    else next.add(dirPath);
    setCollapsedDirs(next);
  };

  // Flatten tree into renderable rows
  const fileTreeRows = createMemo((): FileTreeRow[] =>
    flattenFileTree(fileTree(), collapsedDirs())
  );

  // ── Build flat list of interactive items ──
  const interactiveItems = createMemo((): UncommittedItem[] => {
    const rows = fileTreeRows();
    const items: UncommittedItem[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.isDir) {
        items.push({ type: "file-dir", dirPath: row.dirPath, index: i });
      } else {
        items.push({ type: "file", filePath: row.file!.path, index: i });
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
    }
    // file items have no action
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
      actions.setDetailCursorAction(null);
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

  const findItemIndex = (type: "file-dir" | "file", idx: number): number =>
    itemIndexMap().get(`${type}:${idx}`) ?? -1;

  const isCursored = (itemIndex: number) =>
    state.detailFocused() && state.detailCursorIndex() === itemIndex;

  const highlightBgFocused = () => t().backgroundElementActive;

  const itemHighlightBg = (itemIndex: number): string | undefined => {
    if (state.detailFocused() && state.detailCursorIndex() === itemIndex) {
      return highlightBgFocused();
    }
    return undefined;
  };

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
      const fixedChars = ENTRY_PADDING_LEFT + treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
      const available = pw - fixedChars;
      if (treeRow.name.length <= available) return null;
      return { text: treeRow.name, visibleWidth: available };
    }

    if (item.type === "file") {
      const fw = fileWidths();
      const statWidth = activeTab() === "untracked"
        ? STAT_PADDING_LEFT + STATUS_COL_WIDTH
        : STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + fw.addColWidth + STAT_GAP + fw.delColWidth;
      const fixedChars = ENTRY_PADDING_LEFT + treeRow.prefix.length + treeRow.connector.length + statWidth;
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
            <text fg={t().foregroundMuted}>
              {state.detailLoading()
                ? "Loading..."
                : `No ${activeTab()} files`}
            </text>
          </box>
        }
      >
        {/* Total lines changed (skip for untracked which have 0/0 stats) */}
        <Show when={activeTab() !== "untracked" && (fileWidths().totalAdd > 0 || fileWidths().totalDel > 0)}>
          <box flexDirection="row" paddingLeft={2}>
            <box flexGrow={1}>
              <text fg={t().foregroundMuted} wrapMode="none">
                total lines changed
              </text>
            </box>
            <box flexShrink={0} width={2} />
            <box flexShrink={0} paddingLeft={1}>
              <text fg={t().diffAdded} wrapMode="none">
                +{fileWidths().totalAdd}
              </text>
            </box>
            <box flexShrink={0} paddingLeft={1}>
              <text fg={t().diffRemoved} wrapMode="none">
                -{fileWidths().totalDel}
              </text>
            </box>
          </box>
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
              <box
                flexDirection="row"
                width="100%"
                paddingLeft={2}
                backgroundColor={itemHighlightBg(itemIdx())}
              >
                <box flexShrink={0}>
                  <text fg={t().border} wrapMode="none">
                    {treeRow.prefix}{treeRow.connector}
                  </text>
                </box>
                <Show when={treeRow.isDir}>
                  <box flexShrink={0}>
                    <text fg={cursored() ? t().accent : t().foregroundMuted} wrapMode="none">
                      {collapsed() ? "▸ " : "▾ "}
                    </text>
                  </box>
                </Show>
                <box flexGrow={1}>
                  <text
                    fg={treeRow.isDir
                      ? (cursored() ? t().accent : t().foregroundMuted)
                      : (cursored() ? t().accent : t().foreground)}
                    wrapMode="none"
                    truncate={scrolledName() == null}
                  >
                    {scrolledName() ?? treeRow.name}
                  </text>
                </box>
                {/* Status letter + stats for staged/unstaged; status only for untracked */}
                <Show when={treeRow.file}>
                  <box flexShrink={0} paddingLeft={1}>
                    <text fg={t().foregroundMuted} wrapMode="none">
                      {treeRow.file!.status}
                    </text>
                  </box>
                </Show>
                <Show when={treeRow.file && activeTab() !== "untracked"}>
                  <box flexShrink={0} paddingLeft={1}>
                    <text fg={t().diffAdded} wrapMode="none">
                      {("+" + treeRow.file!.additions).padStart(fileWidths().addColWidth)}
                    </text>
                  </box>
                  <box flexShrink={0} paddingLeft={1}>
                    <text fg={t().diffRemoved} wrapMode="none">
                      {("-" + treeRow.file!.deletions).padStart(fileWidths().delColWidth)}
                    </text>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
