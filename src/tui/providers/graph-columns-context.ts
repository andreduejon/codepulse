/**
 * The graph's two provider columns for the shown view: the provider's own (OpenShift's Live and Cache, Snyk's
 * severities) or a CI provider's counts and last run. The app provides each started provider's; without a provider
 * (a component's own test) every provider view shows the CI columns.
 */
import { createContext, useContext } from "solid-js";
import type { ProviderView } from "../../core/provider-model";
import { useAppState } from "../context/state";
import type { ProviderGraphColumns } from "./module";
import { CI_GRAPH_COLUMNS } from "./shared/ci-columns";

export const GraphColumnsContext = createContext<(view: ProviderView) => ProviderGraphColumns | null>();

const ciColumns = (view: ProviderView) => (view === "git" || view === "dashboard" ? null : CI_GRAPH_COLUMNS);

/** The shown view's provider columns; null in Git. */
export function useGraphColumns(): () => ProviderGraphColumns | null {
  const { state } = useAppState();
  const columnsFor = useContext(GraphColumnsContext) ?? ciColumns;
  return () => columnsFor(state.activeProviderView());
}

/** A commit's badge: by its hash as the graph has it, or in lower case as a provider may key it. */
export const badgeOf = <T>(badges: ReadonlyMap<string, T>, sha: string): T | undefined =>
  badges.get(sha) ?? badges.get(sha.toLowerCase());
