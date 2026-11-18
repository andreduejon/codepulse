/**
 * The provider host: starts each provider module (providers/module.ts) for the open repository with its settings and
 * adapters, and gives the rest of the app one way to reach them: refresh, start over, the data for a commit, the events
 * they hold for the Dashboard, their detail tabs and graph columns, and their messages. It names no provider.
 */
import type { JSX } from "solid-js";
import type { DashboardEvent } from "../../core/dashboard/events";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderSet } from "../../core/provider-set";
import type { AppActions, AppState } from "../context/state";
import { type ProviderDetails, providerDetails } from "../providers/detail-entries";
import {
  type AnyProviderModule,
  type ProviderGraphColumns,
  type ProviderMessage,
  type StartedProvider,
  startModule,
} from "../providers/module";
import { CI_GRAPH_COLUMNS } from "../providers/shared/ci-columns";
import type { JobLogTarget } from "../providers/shared/job-log-dialog";
import type { TabNotice } from "./app-tab-notice";
import type { RepoSettings } from "./repo-settings";

/** A started provider with its module. */
interface Hosted {
  module: AnyProviderModule;
  provider: StartedProvider<unknown, unknown>;
}

export function useProviderHost(opts: {
  state: AppState;
  actions: AppActions;
  /** The providers the app runs with, and their modules: one module per provider, each in the set. */
  providers: ProviderSet;
  modules: readonly AnyProviderModule[];
  settings: RepoSettings;
  /** The cache screen is open: providers pause and touch no cache. */
  suspended: () => boolean;
  onOpenJobLog: (target: JobLogTarget | null) => void;
  onOpenDialog: (render: (close: () => void) => JSX.Element) => void;
}) {
  const { state, providers } = opts;
  for (const module of opts.modules)
    if (!providers.get(module.definition.id))
      throw new Error(`Provider "${module.definition.id}" has a module but is not in the app's provider set`);
  for (const definition of providers.definitions)
    if (!opts.modules.some(module => module.definition.id === definition.id))
      throw new Error(`Provider "${definition.id}" has no module`);

  // Started during setup, before the app's Provider renders (AGENTS.md rule 5): state and actions come as values.
  // In the provider set's order, so the views and the Menu list them alike.
  const hosted: Hosted[] = providers.definitions.map(definition => {
    const module = opts.modules.find(candidate => candidate.definition.id === definition.id) as AnyProviderModule;
    return {
      module,
      provider: startModule(module, {
        state,
        actions: opts.actions,
        repoSettings: opts.settings,
        suspended: opts.suspended,
        onOpenJobLog: opts.onOpenJobLog,
        onOpenDialog: opts.onOpenDialog,
        providers,
      }),
    };
  });
  const byView = new Map(hosted.map(entry => [entry.module.definition.id, entry]));

  /** Fetch a provider's data again, as its Reload does; Snyk scans branch tips on its own. */
  const refresh = async (view: ProviderView) => {
    await byView.get(view)?.provider.refresh?.();
  };

  /** What each provider tab of the details renders, from its provider's entry and source. */
  const details: ProviderDetails = providerDetails(
    hosted.map(entry => entry.module),
    Object.fromEntries(hosted.map(entry => [entry.module.definition.id, entry.provider.detailSource])),
  );

  return {
    /** A started provider, for what only it does. */
    started: (view: ProviderView) => byView.get(view)?.provider,
    refresh,
    /** The shown view's providers: its own, or on the dashboard every one turned on. */
    refreshActive: async () => {
      const view = state.activeProviderView();
      if (view !== "dashboard") return refresh(view);
      await Promise.all(state.providers.getEnabledViews().map(refresh));
    },
    /** Every provider starts over: another repository, or its cache was removed. */
    invalidateAll: () => {
      for (const entry of hosted) entry.provider.invalidate();
    },
    /** The open view's provider's data for a commit; Git and the Dashboard have none. */
    activeCommitData: (sha: string) => byView.get(state.activeProviderView())?.provider.getCommitData(sha) ?? null,
    /** What the open app's providers hold now, as Dashboard events. */
    heldEvents: (app: string) => hosted.flatMap(entry => entry.provider.heldEvents?.(app) ?? []),
    details,
    /** A view's two graph columns: its provider's own, or a CI provider's; none for Git and the Dashboard. */
    graphColumns: (view: ProviderView): ProviderGraphColumns | null => {
      const entry = byView.get(view);
      return entry ? (entry.provider.graphColumns ?? CI_GRAPH_COLUMNS) : null;
    },
    /** Failures of work the providers do on their own, by provider name. */
    backgroundErrors: (): (ProviderMessage & { source: string })[] =>
      hosted.flatMap(entry => {
        const error = entry.provider.backgroundError?.();
        return error ? [{ ...error, source: entry.module.definition.displayName }] : [];
      }),
    /** The notice a provider puts under its tab for a commit. */
    tabNotice: (view: ProviderView, sha: string, tab: string): TabNotice | null =>
      byView.get(view)?.provider.tabNotice?.(sha, tab) ?? null,
    /** The Dashboard selected an event: its provider can read what its tab will show. */
    dashboardSelected: (event: DashboardEvent) => byView.get(event.source)?.provider.onDashboardSelect?.(event),
  };
}

export type ProviderHost = ReturnType<typeof useProviderHost>;
