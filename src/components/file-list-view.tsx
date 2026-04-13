import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { DiffSource, DiffTarget, FileChange } from "../git/types";
import { useFileTree } from "../hooks/use-file-tree";
import { useT } from "../hooks/use-t";
import { isCursored as _isCursored, itemHighlightBg as _itemHighlightBg } from "../utils/detail-cursor";
import { buildDiffTarget } from "../utils/diff-target";
import type { DetailNavRef } from "./detail-types";
import { computeFileWidths } from "./detail-types";
import { FileTreeEntry } from "./file-tree-entry";
import { TotalLinesChangedRow } from "./total-lines-changed-row";

export interface FileListViewProps {
  /** Reactive accessor returning the file list to display. */
  files: () => FileChange[];
  /** When true, show "Loading..." instead of "No modified files". */
  loading?: () => boolean;
  /** Commit hash (newer side) for building diff targets. */
  commitHash: () => string;
  /** Diff source type: "commit" | "stash" etc. */
  diffSource: () => DiffSource;
  /** Identity value — when it changes, collapsed dirs reset. */
  resetTrigger: () => unknown;
  /** Mutable ref populated by this view for keyboard navigation. */
  navRef: DetailNavRef;
  /** Callback to open the diff+blame dialog for a file. */
  onOpenDiff?: (target: DiffTarget) => void;
}

type InteractiveItem =
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string | undefined; index: number };

/**
 * Shared file-list component used by the committed detail Files tab.
 * Renders the file tree with interactive cursor, stat columns, and
 * loading/empty fallback.
 *
 * Does NOT include a scrollbox or header — the parent provides those.
 */
export default function FileListView(props: Readonly<FileListViewProps>) {
  const { state, actions } = useAppState();
  const t = useT();

  // File tree state — resets collapsed dirs when resetTrigger changes
  const { fileTreeRows, collapsedDirs, toggleDir } = useFileTree(props.files, props.resetTrigger);

  // Column widths for stat columns
  const fileWidths = createMemo(() => computeFileWidths(props.files()));

  // Interactive items list — one entry per visible file tree row
  const interactiveItems = createMemo((): InteractiveItem[] => {
    const files = props.files();
    if (files.length === 0) return [];
    const items: InteractiveItem[] = [];
    const rows = fileTreeRows();
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

  // Cursor helpers
  const isCursored = (itemIndex: number) => _isCursored(state, itemIndex);
  const itemHighlightBg = (itemIndex: number) => _itemHighlightBg(state, t(), itemIndex);

  // Element refs for scroll-into-view
  const itemRefs: Renderable[] = [];

  // findItemIndex: linear scan matching type + tree row index
  const findItemIndex = (type: "file-dir" | "file", treeIdx: number): number => {
    const items = interactiveItems();
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === type && items[i].index === treeIdx) return i;
    }
    return -1;
  };

  // Activate an item: toggle dir or open diff
  const activateItem = (item: InteractiveItem) => {
    if (item.type === "file-dir") {
      toggleDir(item.dirPath);
    } else if (item.type === "file" && props.onOpenDiff && item.filePath) {
      const files = props.files();
      const hash = props.commitHash();
      if (hash && files.length > 0) {
        props.onOpenDiff(buildDiffTarget(hash, item.filePath, props.diffSource(), files));
      }
    }
  };

  /** Activate the item at the current cursor index. Returns false (no jump-to-commit). */
  const activateCurrentItem = (): boolean => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx >= 0 && idx < items.length) {
      activateItem(items[idx]);
    }
    return false;
  };

  // Keep navRef updated whenever interactive items change
  createEffect(() => {
    if (props.navRef) {
      props.navRef.itemCount = interactiveItems().length;
      props.navRef.activateCurrentItem = activateCurrentItem;
      props.navRef.itemRefs = itemRefs;
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

  // Keep the footer's contextual enter-key hint in sync
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
      actions.setDetailCursorAction("open diff");
    }
  });

  // Clamp cursor when interactive items change
  createEffect(() => {
    const count = interactiveItems().length;
    if (count === 0) {
      actions.setDetailCursorIndex(-1);
    } else {
      const cur = state.detailCursorIndex();
      if (cur >= count) actions.setDetailCursorIndex(count - 1);
      else if (cur < 0) actions.setDetailCursorIndex(0);
    }
  });

  return (
    <Show
      when={props.files().length > 0}
      fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={t().foregroundMuted}>{props.loading?.() ? "Loading..." : "No modified files"}</text>
        </box>
      }
    >
      <TotalLinesChangedRow totalAdd={fileWidths().totalAdd} totalDel={fileWidths().totalDel} />
      <box height={1} />
      <For each={fileTreeRows()}>
        {(treeRow, i) => {
          const itemIdx = () => findItemIndex(treeRow.isDir ? "file-dir" : "file", i());
          const cursored = () => isCursored(itemIdx());
          const collapsed = () => treeRow.isDir && collapsedDirs().has(treeRow.dirPath);

          return (
            <FileTreeEntry
              row={treeRow}
              cursored={cursored()}
              collapsed={collapsed()}
              highlightBg={itemHighlightBg(itemIdx())}
              scrolledName={null}
              addColWidth={fileWidths().addColWidth}
              delColWidth={fileWidths().delColWidth}
              ref={(el: Renderable) => {
                const idx = itemIdx();
                if (idx >= 0) itemRefs[idx] = el;
              }}
            />
          );
        }}
      </For>
    </Show>
  );
}
