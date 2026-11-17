/**
 * The contract every provider meets: a module the provider host starts for the open repository. It returns the
 * provider (for what only it does) with what the host and the rest of the app read from every provider. Adding a
 * provider is a module here and a line in the host's list, plus its detail tab.
 */
import type { Accessor } from "solid-js";
import type { RepoSettings } from "../app/repo-settings";
import type { AppActions, AppState } from "../core/app-state";
import type { DashboardEvent } from "../core/dashboard/events";
import type { OpenShiftResource } from "../core/openshift/types";
import type { ProviderDetailView } from "../core/provider-model";
import type { JobLogTarget } from "./shared/job-log-dialog";

/** What a provider gets when it starts. Called during the root's setup: state and actions come as values. */
export interface ProviderContext {
  state: AppState;
  actions: AppActions;
  settings: RepoSettings;
  /** The cache screen is open: providers pause and touch no cache. */
  suspended: Accessor<boolean>;
  /** Opens the log viewer on a job, a build's stage or a failed test. */
  onOpenJobLog: (target: JobLogTarget | null) => void;
  onOpenResource: (resource: OpenShiftResource) => void;
}

/** A started provider, as the host and the rest of the app reach it. */
export interface StartedProvider<Instance, DetailSource> {
  /** The provider itself, for what only it does. */
  instance: Instance;
  /** Its data for a commit, for the graph's badges' details and the detail tabs. */
  getCommitData: (sha: string) => unknown;
  /** Starts over: another repository, or its cache was removed. */
  invalidate: () => void;
  /** Fetches again, as its Reload does; a provider without a list to fetch (Snyk) has none. */
  refresh?: () => Promise<void>;
  /** The open app's events it holds now (a running build is only here, not in a cache). */
  heldEvents?: (app: string) => DashboardEvent[];
  /** What its detail tab reads, and where the tab's rows open. */
  detailSource: DetailSource;
}

export interface ProviderModule<Instance, DetailSource> {
  id: ProviderDetailView;
  start: (context: ProviderContext) => StartedProvider<Instance, DetailSource>;
}
