import { MouseButton, type Renderable } from "@opentui/core";
import { createSignal, Show } from "solid-js";
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
  /** Opt-in row mouse controls; stash and sidebar callers leave these disabled. */
  mouseEnabled?: boolean;
  /** Current visible interactive index, recomputed when directories collapse. */
  itemIndex?: number;
  /** Select this index and invoke the view's existing keyboard activation. */
  onActivate?: (itemIndex: number) => void;
  /** Optional ref callback forwarded to the outermost box for scroll-into-view. */
  ref?: (el: Renderable) => void;
}

/**
 * Shared file-tree row renderer used by committed, uncommitted, and stash detail.
 *
 * Renders: tree connectors → optional collapse indicator → file/dir name →
 * status letter → optional +/- stat columns.
 */
export function FileTreeEntry(props: FileTreeEntryProps) {
  const t = useT();
  const [hovered, setHovered] = createSignal(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI rows also support cursor navigation and Enter.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Hover does not change keyboard focus.
    <box
      ref={props.ref}
      flexDirection="row"
      width="100%"
      backgroundColor={props.highlightBg ?? (props.mouseEnabled && hovered() ? t().backgroundElement : undefined)}
      onMouseOver={() => {
        if (props.mouseEnabled) setHovered(true);
      }}
      onMouseOut={() => setHovered(false)}
      onMouseDown={event => {
        const index = props.itemIndex ?? -1;
        if (!props.mouseEnabled || event.button !== MouseButton.LEFT || index < 0 || !props.onActivate) return;
        event.preventDefault();
        event.stopPropagation();
        props.onActivate(index);
      }}
    >
      {/* Tree connector prefix */}
      <box flexShrink={0}>
        <text selectable={!props.mouseEnabled} fg={t().border} wrapMode="none">
          {props.row.prefix}
          {props.row.connector}
        </text>
      </box>

      {/* Collapse/expand indicator for directories */}
      <Show when={props.row.isDir}>
        <box flexShrink={0}>
          <text selectable={!props.mouseEnabled} fg={props.cursored ? t().accent : t().foregroundMuted} wrapMode="none">
            {props.collapsed ? "▸ " : "▾ "}
          </text>
        </box>
      </Show>

      {/* File/directory name (with banner scroll when cursored + overflow) */}
      <box flexGrow={1}>
        <text
          selectable={!props.mouseEnabled}
          fg={
            props.row.isDir
              ? props.cursored
                ? t().accent
                : t().foreground
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
          <text selectable={!props.mouseEnabled} fg={t().foregroundMuted} wrapMode="none">
            {props.row.file?.status}
          </text>
        </box>
      </Show>

      {/* Addition / deletion stats (hidden when hideStats=true, e.g. untracked files) */}
      <Show when={props.row.file && !props.hideStats}>
        <box flexShrink={0} paddingLeft={1}>
          <text selectable={!props.mouseEnabled} fg={t().diffAdded} wrapMode="none">
            {`+${props.row.file?.additions}`.padStart(props.addColWidth)}
          </text>
        </box>
        <box flexShrink={0} paddingLeft={1}>
          <text selectable={!props.mouseEnabled} fg={t().diffRemoved} wrapMode="none">
            {`-${props.row.file?.deletions}`.padStart(props.delColWidth)}
          </text>
        </box>
      </Show>
    </box>
  );
}
