import type { Renderable } from "@opentui/core";
import { For, Show } from "solid-js";
import type { Commit } from "../git/types";
import { useT } from "../hooks/use-t";
import type { FileTreeRow } from "../utils/file-tree";
import { ENTRY_PADDING_LEFT } from "./detail-types";
import { FileTreeEntry } from "./file-tree-entry";
import { TotalLinesChangedRow } from "./total-lines-changed-row";

/** Pre-computed display data for a single file row inside a stash. */
export interface StashFileRowData {
  row: FileTreeRow;
  cursored: boolean;
  collapsed: boolean;
  highlightBg: string | undefined;
  scrolledName: string | null;
  /** Optional ref callback forwarded to the FileTreeEntry for scroll-into-view. */
  ref?: (el: Renderable) => void;
}

export interface StashEntryProps {
  /** The stash commit object. */
  stash: Commit;
  /** Whether to show a spacer above this entry (true for all but the first). */
  showSpacer: boolean;
  /** Whether this stash is expanded. */
  expanded: boolean;
  /** Highlight background color for the header row (undefined = not cursored). */
  headerHighlightBg: string | undefined;
  /** Banner-scrolled header label text (null = use label as-is, with truncation). */
  scrolledHeaderText: string | null;
  /** Pre-computed file rows with per-row display state. */
  fileRows: StashFileRowData[];
  /** Total loaded file count for the file count suffix (undefined = files not yet loaded). */
  fileCount: number | undefined;
  /** Column widths for the file stat display. */
  addColWidth: number;
  delColWidth: number;
  totalAdd: number;
  totalDel: number;
  /** Optional ref callback for the header row box (scroll-into-view). */
  headerRef?: (el: Renderable) => void;
}

/**
 * Renders a single collapsible stash entry in the stashes tab of the detail panel.
 *
 * All cursor/scroll/highlight state is pre-computed by the parent and passed as
 * plain props, keeping this component purely presentational.
 */
export function StashEntry(props: Readonly<StashEntryProps>) {
  const t = useT();

  const label = () => props.stash.refs[0]?.name ?? "stash";

  return (
    <>
      {/* Spacer between stash entries (not before the first one) */}
      <Show when={props.showSpacer}>
        <box height={1} />
      </Show>

      {/* Stash entry header — label + file count only */}
      <box ref={props.headerRef} backgroundColor={props.headerHighlightBg}>
        <text fg={t().accent} wrapMode="none" truncate={props.scrolledHeaderText == null}>
          <strong>
            {props.expanded ? "▾" : "▸"} {props.scrolledHeaderText ?? label()}
            {props.fileCount != null ? ` (${props.fileCount})` : ""}
          </strong>
        </text>
      </box>

      {/* Expanded area: description + total lines changed + file tree */}
      <Show when={props.expanded}>
        {/* Stash description (subject line) */}
        <box paddingLeft={ENTRY_PADDING_LEFT}>
          <text fg={t().foregroundMuted} wrapMode="none" truncate>
            {props.stash.subject}
          </text>
        </box>
        <box height={1} />

        {/* Total lines changed (only after files are loaded) */}
        <Show when={props.totalAdd > 0 || props.totalDel > 0}>
          <TotalLinesChangedRow totalAdd={props.totalAdd} totalDel={props.totalDel} />
        </Show>

        <For each={props.fileRows}>
          {fileRowData => (
            <FileTreeEntry
              ref={fileRowData.ref}
              row={fileRowData.row}
              cursored={fileRowData.cursored}
              collapsed={fileRowData.collapsed}
              highlightBg={fileRowData.highlightBg}
              scrolledName={fileRowData.scrolledName}
              addColWidth={props.addColWidth}
              delColWidth={props.delColWidth}
            />
          )}
        </For>
      </Show>
    </>
  );
}
