/**
 * The provider host: starts each provider module (providers/module.ts) for the open repository with its settings, and
 * gives the rest of the app one way to reach them: refresh, start over, the data for a commit, the events they hold
 * for the Dashboard, and what the detail tabs read.
 */
import type { ProviderView } from "../../core/provider-model";
import type { ProviderDetailSources } from "../providers/detail-entries";
import { githubModule } from "../providers/github-actions/module";
import { jenkinsModule } from "../providers/jenkins/module";
import type { ProviderContext, StartedProvider } from "../providers/module";
import { openShiftModule } from "../providers/openshift/module";
import { snykModule } from "../providers/snyk/module";
import type { RepoSettings } from "./repo-settings";

export function useProviderHost(opts: Omit<ProviderContext, "settings"> & { settings: RepoSettings }) {
  const { state } = opts;
  // Started during setup, before the app's Provider renders (AGENTS.md rule 5): state and actions come as values.
  const github = githubModule.start(opts);
  const jenkins = jenkinsModule.start(opts);
  const openShift = openShiftModule.start(opts);
  const snyk = snykModule.start(opts);
  const entries: Partial<Record<ProviderView, StartedProvider<unknown, unknown>>> = {
    [githubModule.id]: github,
    [jenkinsModule.id]: jenkins,
    [openShiftModule.id]: openShift,
    [snykModule.id]: snyk,
  };
  const hosted = () => Object.values(entries).filter(provider => provider !== undefined);

  /** Fetch a provider's data again, as its Reload does; Snyk scans branch tips on its own. */
  const refresh = async (view: ProviderView) => {
    await entries[view]?.refresh?.();
  };

  /** What each provider tab of the details reads, and where its rows open (logs, resources). */
  const detailSources: ProviderDetailSources = {
    "github-actions": github.detailSource,
    jenkins: jenkins.detailSource,
    openshift: openShift.detailSource,
    snyk: snyk.detailSource,
  };

  return {
    /** Each provider itself, for what only it does (Snyk's cached scans, OpenShift's logs and objects). */
    github: github.instance,
    jenkins: jenkins.instance,
    openShift: openShift.instance,
    snyk: snyk.instance,
    refresh,
    /** The shown view's providers: its own, or on the dashboard every one turned on. */
    refreshActive: async () => {
      const view = state.activeProviderView();
      if (view !== "dashboard") return refresh(view);
      await Promise.all(state.providers.getEnabledViews().map(refresh));
    },
    /** Every provider starts over: another repository, or its cache was removed. */
    invalidateAll: () => {
      for (const provider of hosted()) provider.invalidate();
    },
    /** The open view's provider's data for a commit; Git and the Dashboard have none. */
    activeCommitData: (sha: string) => entries[state.activeProviderView()]?.getCommitData(sha) ?? null,
    /** What the open app's providers hold now, as Dashboard events. */
    heldEvents: (app: string) => hosted().flatMap(provider => provider.heldEvents?.(app) ?? []),
    detailSources,
  };
}

export type ProviderHost = ReturnType<typeof useProviderHost>;
