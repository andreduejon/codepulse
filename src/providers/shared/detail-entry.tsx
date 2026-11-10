/**
 * The contract between the detail view and a provider. A provider hands the detail view a source (its data for a
 * commit, its status, what its rows open) and registers an entry per detail tab: what the tab renders and the legend
 * below it. The detail view then needs no provider-specific code; a new provider is a source and an entry
 * (`providers/detail-entries.ts`).
 */

import type { Component, JSX } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import type { ProviderStatus } from "../../context/state";
import type { ProviderDetailSources } from "../detail-entries";
import type { ProviderDetailView } from "../provider";
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
  /** State a tab keeps across tab switches (one value per key, for as long as the detail view lives). */
  memory: <T>(key: string, create: () => T) => T;
}

/** A provider's detail tab: the source it reads, what it renders, and the legend below it. */
export interface ProviderDetailEntry<V extends ProviderDetailView> {
  view: V;
  Tab: Component<{ source: ProviderDetailSources[V]; context: DetailEntryContext }>;
  /** The marks to explain below the tree, when the commit has something to explain. */
  legend?: (source: ProviderDetailSources[V], sha: string) => readonly LegendItem[] | null;
}

/** An entry with its source type left out, so one table holds every provider's. */
export interface DetailEntry {
  view: ProviderDetailView;
  render: (sources: Partial<ProviderDetailSources>, context: DetailEntryContext) => JSX.Element;
  legend: (sources: Partial<ProviderDetailSources>, sha: string) => readonly LegendItem[] | null;
}

export function detailEntry<V extends ProviderDetailView>(entry: ProviderDetailEntry<V>): DetailEntry {
  const sourceOf = (sources: Partial<ProviderDetailSources>) =>
    sources[entry.view] as ProviderDetailSources[V] | undefined;
  return {
    view: entry.view,
    render: (sources, context) => {
      const source = sourceOf(sources);
      const Tab = entry.Tab;
      return source ? <Tab source={source} context={context} /> : null;
    },
    legend: (sources, sha) => {
      const source = sourceOf(sources);
      return source && entry.legend ? entry.legend(source, sha) : null;
    },
  };
}
