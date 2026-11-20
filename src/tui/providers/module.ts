/**
 * The contract every provider meets in the terminal: a module the provider host starts for the open repository, with
 * everything the rest of the app shows of it (its colors, its Menu rows, its detail tabs, its graph columns, its
 * Dashboard legend). The root lists the modules once (src/providers.ts); no other file names a provider. Its
 * definition in core holds its names and settings; the adapters it runs on come from the app's provider set.
 */

import type { Accessor, Component, JSX } from "solid-js";
import type { DashboardEvent } from "../../core/dashboard/events";
import type { GraphBadge } from "../../core/provider-model";
import type { ProviderDefinition, ProviderSet } from "../../core/provider-set";
import type { SettingsSection } from "../../core/settings/provider-section";
import type { TabNotice } from "../app/app-tab-notice";
import type { RepoSettings } from "../app/repo-settings";
import type { AppActions, AppState } from "../context/state";
import type { Theme } from "../context/theme";
import type { SettingItem } from "../hooks/menu-items-types";
import type { HelpRow } from "../keybinds";
import type { GraphColumnWidths } from "./graph-column-widths";
import type { DetailEntry } from "./shared/detail-entry";
import type { LegendItem } from "./shared/detail-legend";
import type { JobLogTarget } from "./shared/job-log-dialog";

/** What a provider gets when it starts. Called during the root's setup: state and actions come as values. */
export interface ProviderContext<Adapters, Settings extends SettingsSection> {
  state: AppState;
  actions: AppActions;
  /** Its settings, its defaults filled in; they change when the Menu changes them or another repository opens. */
  settings: Accessor<Settings>;
  /** Every provider's settings and the repository's. */
  repoSettings: RepoSettings;
  /** The cache screen is open: providers pause and touch no cache. */
  suspended: Accessor<boolean>;
  /** Opens the log viewer on a job, a build's stage or a failed test. */
  onOpenJobLog: (target: JobLogTarget | null) => void;
  /** Opens one of its own dialogs (OpenShift's resource) over the app; it calls `close` to go back. */
  onOpenDialog: (render: (close: () => void) => JSX.Element) => void;
  /** Its API, cache and token: the root's (src/ports.ts). */
  adapters: Adapters;
}

/** A provider's two columns in the graph, in place of Author and Date. */
export interface ProviderGraphColumns {
  /** How wide the two columns are for these badges: wide enough for the widest. */
  widths: (badges: ReadonlyMap<string, GraphBadge>) => GraphColumnWidths;
  Headers: Component<GraphColumnWidths>;
  /** A commit's two cells. */
  Cells: Component<{
    sha: string;
    badge: GraphBadge | undefined;
    uncommitted: boolean;
    active: boolean;
    dimmed: boolean;
    widths: GraphColumnWidths;
  }>;
  /**
   * Names it adds after a commit's refs, in its colour (OpenShift: the namespaces that run it; GitHub: the pull
   * requests whose branch points at it), muted ones dimmed (a draft). A `whole` one is never shortened (`PR #12345`:
   * a cut number reads as another): when it does not fit, it goes into `+N`.
   */
  refs?: (sha: string, badge: GraphBadge | undefined) => readonly { name: string; muted?: boolean; whole?: boolean }[];
  /** A line at the end of the graph about what it holds for commits the graph doesn't show. */
  unseen?: (shown: ReadonlySet<string>, badges: ReadonlyMap<string, GraphBadge>) => string | null;
}

/** What one of its messages says: a failure in the background, or a notice on its tab. */
export interface ProviderMessage {
  message: string;
  dismiss: () => void;
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
  /** What its detail tabs read, and where the tabs' rows open. */
  detailSource: DetailSource;
  /** Its columns in the graph; a CI provider's pass and fail counts and last run when it has none of its own. */
  graphColumns?: ProviderGraphColumns;
  /** A failure of work it does on its own (Snyk's scans), shown in every view until dismissed. */
  backgroundError?: Accessor<ProviderMessage | null>;
  /** A notice under its detail tab for a commit (Snyk: what a partial scan left out). */
  tabNotice?: (sha: string, tab: string) => TabNotice | null;
  /** The Dashboard selected one of its events: it can read what the event's tab will show. */
  onDashboardSelect?: (event: DashboardEvent) => void;
}

/** What its rows in Menu → Providers get. */
export interface ProviderMenuContext<Settings extends SettingsSection> {
  settings: Settings;
  /** Changes its settings and saves them. */
  update: (next: Settings) => void;
  /** When it last fetched or scanned, as its rows show it. */
  lastRefresh: () => string;
  /** Whether a token variable is set (the system port answers; the menu never reads the environment). */
  tokenIsSet: (envVar: string) => boolean;
  state: AppState;
}

export interface ProviderModule<Adapters, Settings extends SettingsSection, Instance, DetailSource> {
  definition: ProviderDefinition<Adapters, Settings>;
  start: (context: ProviderContext<Adapters, Settings>) => StartedProvider<Instance, DetailSource>;
  /** Its badge's colors, from the theme; one a theme lacks (made before the provider) falls back to the accent. */
  colors: (theme: Theme) => { bg?: string; fg?: string };
  /** Its section of Menu → Providers, its header first. */
  menuItems: (menu: ProviderMenuContext<Settings>) => SettingItem[];
  /** What its own detail tab and the ones it adds render, by tab. */
  detailEntries: Readonly<Record<string, DetailEntry<DetailSource>>>;
  /** Its section of Help → Providers and of `codepulse --help`: its Menu rows explained, its name first. */
  help?: readonly HelpRow[];
  /** The marks its events show on the Dashboard, explained in the side panel. */
  legend: readonly LegendItem[];
  /** The mark before one of its events on the Dashboard; how its run or build ended by default. */
  eventMark?: (event: DashboardEvent) => { icon: string; color: (theme: Theme) => string } | null;
}

/** A module with its types left out, so one list holds every provider's. */
export type AnyProviderModule = ProviderModule<unknown, SettingsSection, unknown, unknown>;

/** A module, its parts checked against each other (its start, Menu rows and detail tabs against its definition). */
export function providerModule<Adapters, Settings extends SettingsSection, Instance, DetailSource>(
  module: ProviderModule<Adapters, Settings, Instance, DetailSource>,
): ProviderModule<Adapters, Settings, Instance, DetailSource> {
  return module;
}

/**
 * Each provider's module, in the set's order: exactly one per provider, carrying the definition the set has, with a
 * detail entry for each of its tabs and for no other. Anything else is refused before any module starts.
 */
export function modulesFor(providers: ProviderSet, modules: readonly AnyProviderModule[]): AnyProviderModule[] {
  const byId = new Map<string, AnyProviderModule>();
  for (const module of modules) {
    const { id } = module.definition;
    if (byId.has(id)) throw new Error(`Provider "${id}" has two modules`);
    const registered = providers.get(id);
    if (!registered) throw new Error(`Provider "${id}" has a module but is not in the app's provider set`);
    if (registered !== module.definition) throw new Error(`Provider "${id}" has a module for another definition`);
    const tabs = new Set(providers.tabsOf(id).map(tab => tab.id));
    for (const tab of Object.keys(module.detailEntries))
      if (!tabs.has(tab)) throw new Error(`Provider "${id}" renders a detail tab it doesn't have: "${tab}"`);
    // A tab it has but doesn't render would show nothing.
    for (const tab of tabs)
      if (!Object.hasOwn(module.detailEntries, tab))
        throw new Error(`Provider "${id}" has no renderer for its detail tab "${tab}"`);
    byId.set(id, module);
  }
  return providers.definitions.map(definition => {
    const module = byId.get(definition.id);
    if (!module) throw new Error(`Provider "${definition.id}" has no module`);
    return module;
  });
}

/** Starts a module with its own adapters and settings from the app's. */
export function startModule(
  module: AnyProviderModule,
  context: Omit<ProviderContext<unknown, SettingsSection>, "adapters" | "settings"> & { providers: ProviderSet },
): StartedProvider<unknown, unknown> {
  const { providers, ...rest } = context;
  return module.start({
    ...rest,
    adapters: providers.adapters(module.definition),
    settings: context.repoSettings.of(module.definition),
  });
}
