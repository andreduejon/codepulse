/**
 * The contract between the detail view and a provider. A provider hands the detail view a source (its data for a
 * commit, its status, what its rows open) and an entry per detail tab in its module: what the tab renders and the
 * legend below it. The detail view then needs no provider-specific code.
 */

import type { Component, JSX } from "solid-js";
import type { DiffTarget } from "../../../core/git/types";
import type { ProviderDetailView } from "../../../core/provider-model";
import type { DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import type { ProviderStatus } from "../../context/state";
import type { LegendItem } from "./detail-legend";
import type { RowShortcut } from "./open-row";

/** What every provider's source has: its data for a commit, and its status (a getter, so it stays reactive). */
export interface ProviderDetailSource<TData> {
  getCommitData: (sha: string) => TData | null;
  readonly status?: ProviderStatus;
}

/** The detail cursor a tab drives. */
export interface DetailCursor {
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
}

/** What the detail view hands every provider tab. Its fields are getters, so they stay reactive. */
export interface DetailEntryContext {
  readonly sha: string;
  readonly cursor: DetailCursor;
  readonly mouseEnabled?: boolean;
  readonly onMouseFocus?: () => void;
  readonly contentWidth?: number;
  /**
   * Why a provider cannot load: its status reason or, once that banner was dismissed, its own readiness check, so
   * closing a message never re-enables an action that cannot work. Null when it can.
   */
  unavailable: (view: ProviderDetailView, status: ProviderStatus | undefined) => string | null;
  /** State a tab keeps while it is not shown: across tab switches and the switch between the two layouts. */
  memory: DetailMemory;
  /** The entry the tab is shown for (the dashboard's event: a run's or a build's id): opened and marked. */
  readonly target?: string;
  /** The marked entry's color (the dashboard's). */
  readonly targetColor?: string;
  /** Opens the diff dialog on a file (GitHub's pull request's); without it a tab's files don't open. */
  readonly onOpenDiff?: (target: DiffTarget) => void;
}

/** A provider's detail tab: what it renders from its provider's source, and the legend below it. */
export interface ProviderDetailEntry<Source> {
  Tab: Component<{ source: Source; context: DetailEntryContext }>;
  /** The marks to explain below the tree, when the commit has something to explain. */
  legend?: (source: Source, sha: string) => readonly LegendItem[] | null;
  /**
   * A tab only some commits have (GitHub's Pull requests): its label for a commit, null to hide it there. Without it
   * the tab shows on every commit, with its provider's label.
   */
  label?: (source: Source, sha: string) => string | null;
}

/** A tab as the detail view draws it, from its provider's source. */
export interface DetailEntry<Source> {
  render: (source: Source, context: DetailEntryContext) => JSX.Element;
  legend: (source: Source, sha: string) => readonly LegendItem[] | null;
  /** Its label for a commit, null when the commit hasn't it; undefined when every commit has it. */
  label: (source: Source, sha: string) => string | null | undefined;
}

export function detailEntry<Source>(entry: ProviderDetailEntry<Source>): DetailEntry<Source> {
  return {
    render: (source, context) => {
      const Tab = entry.Tab;
      return <Tab source={source} context={context} />;
    },
    legend: (source, sha) => (entry.legend ? entry.legend(source, sha) : null),
    label: (source, sha) => entry.label?.(source, sha),
  };
}
