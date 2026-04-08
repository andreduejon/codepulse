import type { Renderable } from "@opentui/core";
import { Show } from "solid-js";
import { useT } from "../hooks/use-t";
import type { FileTreeRow } from "../utils/file-tree";

interface FileTreeEntryProps {
  /** The row data from flattenFileTree. */
  row: FileTreeRow;
  /** Whether this row is the currently-cursored interactive item. */
  cursored: boolean;
  /** Whether this directory is collapsed (false for file rows). */
  collapsed: boolean;
  /** Background color for cursor highlight (undefined = no highlight). */
  highlightBg: string | undefined;
  /** Banner-scrolled display name, or null when not scrolling. */
  scrolledName: string | null;
  /** Character width for the additions stat column. */
  addColWidth: number;
  /** Character width for the deletions stat column. */
  delColWidth: number;
  /**
   * When true, the additions/deletions stat columns are hidden.
   * Used by uncommitted-detail's "untracked" tab where stats are unavailable.
   */
  hideStats?: boolean;
  /** Optional ref callback forwarded to the outermost box for scroll-into-view. */
  ref?: (el: Renderable) => void;
}

/**
 * Shared file-tree row renderer used by detail.tsx and uncommitted-detail.tsx.
 *
 * Renders: tree connectors → optional collapse indicator → file/dir name →
 * status letter → optional +/- stat columns.
 */
export function FileTreeEntry(props: FileTreeEntryProps) {
  const t = useT();

  return (
    <box ref={props.ref} flexDirection="row" width="100%" backgroundColor={props.highlightBg}>
      {/* Tree connector prefix */}
      <box flexShrink={0}>
        <text fg={t().border} wrapMode="none">
          {props.row.prefix}
          {props.row.connector}
        </text>
      </box>

      {/* Collapse/expand indicator for directories */}
      <Show when={props.row.isDir}>
        <box flexShrink={0}>
          <text fg={props.cursored ? t().accent : t().foregroundMuted} wrapMode="none">
            {props.collapsed ? "▸ " : "▾ "}
          </text>
        </box>
      </Show>

      {/* File/directory name (with banner scroll when cursored + overflow) */}
      <box flexGrow={1}>
        <text
          fg={
            props.row.isDir
              ? props.cursored
                ? t().accent
                : t().foregroundMuted
              : props.cursored
                ? t().accent
                : t().foreground
          }
          wrapMode="none"
          truncate={props.scrolledName == null}
        >
          {props.scrolledName ?? props.row.name}
        </text>
      </box>

      {/* Status letter (always shown when file is present) */}
      <Show when={props.row.file}>
        <box flexShrink={0} paddingLeft={1}>
          <text fg={t().foregroundMuted} wrapMode="none">
            {props.row.file?.status}
          </text>
        </box>
      </Show>

      {/* Addition / deletion stats (hidden when hideStats=true, e.g. untracked files) */}
      <Show when={props.row.file && !props.hideStats}>
        <box flexShrink={0} paddingLeft={1}>
          <text fg={t().diffAdded} wrapMode="none">
            {`+${props.row.file?.additions}`.padStart(props.addColWidth)}
          </text>
        </box>
        <box flexShrink={0} paddingLeft={1}>
          <text fg={t().diffRemoved} wrapMode="none">
            {`-${props.row.file?.deletions}`.padStart(props.delColWidth)}
          </text>
        </box>
      </Show>
    </box>
  );
}
