/**
 * The provider tabs of the detail view: each started provider's entries (from its module) with its source. The detail
 * view asks here by tab, so it names no provider.
 */

import type { JSX } from "solid-js";
import type { AnyProviderModule } from "./module";
import type { DetailEntryContext, ProviderDetailSource } from "./shared/detail-entry";
import type { LegendItem } from "./shared/detail-legend";

export interface ProviderDetails {
  /** Every provider tab, in the providers' order. */
  tabs: () => readonly string[];
  /** A provider tab's content; null for a tab no provider has. */
  render: (tab: string, context: DetailEntryContext) => JSX.Element | null;
  /** The legend below a provider tab for a commit. */
  legend: (tab: string, sha: string) => readonly LegendItem[] | null;
  /** A provider view's source: its data for a commit and its status. */
  source: (view: string) => ProviderDetailSource<unknown> | undefined;
  /** A tab's label for a commit: null when the commit hasn't it (it is hidden), undefined for its provider's label. */
  label: (tab: string, sha: string) => string | null | undefined;
}

/** No provider tabs: a detail view rendered without the app's providers (a component's own test). */
export const NO_PROVIDER_DETAILS: ProviderDetails = {
  tabs: () => [],
  render: () => null,
  legend: () => null,
  source: () => undefined,
  label: () => undefined,
};

/** The provider tabs of these modules, each reading its provider's source (by provider view). */
export function providerDetails(
  modules: readonly AnyProviderModule[],
  sources: Readonly<Record<string, unknown>>,
): ProviderDetails {
  /** A tab's entry and its provider's source: its own tab, or one it adds. */
  const find = (tab: string) => {
    const module = modules.find(candidate => Object.hasOwn(candidate.detailEntries, tab));
    const source = module && sources[module.definition.id];
    return module && source !== undefined ? { entry: module.detailEntries[tab], source } : null;
  };
  return {
    tabs: () => modules.flatMap(module => Object.keys(module.detailEntries)),
    render: (tab, context) => {
      const found = find(tab);
      return found?.entry ? found.entry.render(found.source, context) : null;
    },
    legend: (tab, sha) => {
      const found = find(tab);
      return found?.entry ? found.entry.legend(found.source, sha) : null;
    },
    source: view => sources[view] as ProviderDetailSource<unknown> | undefined,
    label: (tab, sha) => {
      const found = find(tab);
      return found?.entry ? found.entry.label(found.source, sha) : undefined;
    },
  };
}
