/**
 * The provider host: starts each provider for the open repository with its settings, and gives the rest of the app
 * one way to reach them — refresh, start over, the data for a commit, the events they hold for the Dashboard, and what
 * the detail tabs read. Adding a provider means a row in `entries` here instead of a case in every caller.
 */
import type { Accessor } from "solid-js";
import type { AppActions, AppState } from "../context/state";
import type { DashboardEvent } from "../core/dashboard/events";
import { githubEvents, jenkinsEvents, openShiftEvents } from "../core/dashboard/events";
import type { GitHubJob, GitHubWorkflowRun } from "../core/github/types";
import type { JenkinsFailedTest, JenkinsJob, JenkinsRun } from "../core/jenkins/types";
import type { OpenShiftResource } from "../core/openshift/types";
import type { ProviderView } from "../core/provider-model";
import type { ProviderDetailSources } from "../providers/detail-entries";
import { githubJobLogTarget } from "../providers/github-actions/log-target";
import { useGitHubCI } from "../providers/github-actions/use-github-ci";
import { jenkinsBuildLogTarget, jenkinsTestFailureTarget } from "../providers/jenkins/log-target";
import { useJenkinsCI } from "../providers/jenkins/use-jenkins-ci";
import { useOpenShift } from "../providers/openshift/use-openshift";
import type { JobLogTarget } from "../providers/shared/job-log-dialog";
import { useSnyk } from "../providers/snyk/use-snyk";
import type { RepoSettings } from "./repo-settings";

/** What every provider offers the host; a provider without a list to fetch again (Snyk) has no `refresh`. */
interface HostedProvider {
  getCommitData: (sha: string) => unknown;
  invalidate: () => void;
  refresh?: () => Promise<void>;
  /** The open app's events it holds now (a running build is only here, not in a cache). */
  heldEvents?: (app: string) => DashboardEvent[];
}

export function useProviderHost(opts: {
  state: AppState;
  actions: AppActions;
  settings: RepoSettings;
  /** The cache screen is open: providers pause and touch no cache. */
  suspended: Accessor<boolean>;
  onOpenJobLog: (target: JobLogTarget | null) => void;
  onOpenResource: (resource: OpenShiftResource) => void;
}) {
  const { state, actions, settings, suspended } = opts;
  // Called during setup, before the app's Provider renders (AGENTS.md rule 5): state and actions come as parameters.
  const github = useGitHubCI({ state, actions, config: settings.github, suspended });
  const jenkins = useJenkinsCI({ state, actions, config: settings.jenkins, suspended });
  const openShift = useOpenShift({ state, actions, config: settings.openShift, suspended });
  const snyk = useSnyk({ state, actions, config: settings.snyk, suspended });

  const entries: Partial<Record<ProviderView, HostedProvider>> = {
    "github-actions": {
      getCommitData: github.getCommitData,
      invalidate: github.invalidate,
      refresh: github.refresh,
      heldEvents: app => githubEvents(app, github.heldEntries()),
    },
    jenkins: {
      getCommitData: jenkins.getCommitData,
      invalidate: jenkins.invalidate,
      refresh: jenkins.refresh,
      heldEvents: app => jenkinsEvents(app, jenkins.heldEntries()),
    },
    openshift: {
      getCommitData: openShift.getCommitData,
      invalidate: openShift.invalidate,
      refresh: openShift.refresh,
      heldEvents: app => openShiftEvents(app, openShift.heldEntries()),
    },
    snyk: { getCommitData: snyk.getCommitData, invalidate: snyk.invalidate },
  };
  const hosted = () => Object.values(entries);

  /** Fetch a provider's data again, as its Reload does; Snyk scans branch tips on its own. */
  const refresh = async (view: ProviderView) => {
    await entries[view]?.refresh?.();
  };

  /** What each provider tab of the details reads, and where its rows open (logs, resources). */
  const detailSources = {
    "github-actions": {
      getCommitData: github.getCommitData,
      fetchJobsForRun: github.fetchJobsForRun,
      fetchCommitData: github.fetchCommitDataForSHA,
      get status() {
        return state.providerStatusFor("github-actions");
      },
      onOpenJobLog: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[], search?: string) =>
        opts.onOpenJobLog(githubJobLogTarget(github, job, run, jobs ?? [job], search)),
    },
    jenkins: {
      getCommitData: jenkins.getCommitData,
      fetchJobsForRun: jenkins.fetchJobsForRun,
      fetchCommitData: jenkins.fetchCommitDataForSHA,
      get status() {
        return state.providerStatusFor("jenkins");
      },
      onOpenBuild: (run: JenkinsRun, pipeline: JenkinsJob, entry: number) =>
        opts.onOpenJobLog(jenkinsBuildLogTarget(jenkins, run, pipeline, entry)),
      onOpenTestFailure: (run: JenkinsRun, failed: JenkinsFailedTest[], index: number) =>
        opts.onOpenJobLog(jenkinsTestFailureTarget(run, failed, index)),
    },
    openshift: {
      getCommitData: openShift.getCommitData,
      fetchCommitData: openShift.fetchCommitDataForSHA,
      isLoading: openShift.isLoading,
      liveAge: openShift.liveAge,
      consoleUrl: () => settings.openShift().consoleUrl,
      get status() {
        return state.providerStatusFor("openshift");
      },
      onOpenResource: opts.onOpenResource,
    },
    snyk: {
      getCommitData: snyk.getCommitData,
      isScanning: snyk.isScanning,
      scanCommit: snyk.scanCommit,
      get status() {
        return state.providerStatusFor("snyk");
      },
    },
  } satisfies ProviderDetailSources;

  return {
    /** Each provider itself, for what only it does (Snyk's cached scans, OpenShift's logs and objects). */
    github,
    jenkins,
    openShift,
    snyk,
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
