/**
 * The providers the app runs with, as core knows them: each one's definition (its id, names and settings) and the
 * adapters the composition root built for it. The root lists them once (src/providers.ts); everything else reads
 * them here, so no other file lists the providers by hand.
 */

import type { DashboardEvent } from "./dashboard/events";
import type { ProviderSettingsDefinition, SettingsSection } from "./settings/provider-section";

export type ProviderCategory = "source" | "ci" | "runtime" | "scan-quality";

/** A detail tab a provider adds after its own: Snyk's Dependencies. */
export interface ProviderTab {
  id: string;
  label: string;
}

export interface ProviderDefinition<Adapters = unknown, Settings extends SettingsSection = SettingsSection> {
  /** Its view, its detail tab and its events' source: `github-actions`. */
  id: string;
  /** Its section under `providers` in the settings file, and its name in `:hide` and `:show`: `github`. */
  key: string;
  displayName: string;
  /** Its detail tab's label; its display name by default. */
  detailLabel?: string;
  category: ProviderCategory;
  /** Detail tabs after its own. */
  moreTabs?: readonly ProviderTab[];
  /**
   * Its messages (core/<provider>/banner.ts, made with banners()): carrying them here loads them with the provider, so
   * the app knows them as messages to show as they are whenever the provider is in its set.
   */
  messages?: Readonly<Record<string, unknown>>;
  /** Its settings: their defaults, how they are read from the file, what a backfill writes. */
  settings: ProviderSettingsDefinition<Settings>;
  /** The Dashboard events it stored for an app (finished runs, builds, scans), read through its adapters. */
  storedEvents?(adapters: Adapters, app: string): Promise<DashboardEvent[]>;
  /**
   * Never set: it only carries the adapters' type, so the set hands a provider's adapters back typed
   * (`providers.adapters(githubProvider)`).
   */
  adapterType?(adapters: Adapters): void;
}

/** A provider definition and the adapters built for it. */
export interface ProviderEntry {
  definition: ProviderDefinition<unknown, SettingsSection>;
  adapters: unknown;
}

/** Joins a definition with its adapters, checking they are the ones it runs on. */
export function providerEntry<Adapters, Settings extends SettingsSection>(
  definition: ProviderDefinition<Adapters, Settings>,
  adapters: Adapters,
): ProviderEntry {
  return { definition: definition as unknown as ProviderDefinition<unknown, SettingsSection>, adapters };
}

/** The views the app always has: the Dashboard over every provider, and the repository's Git. */
const OWN_VIEWS = { dashboard: "Dashboard", git: "Git" } as const;

export interface ProviderSet {
  /** The providers, in the order the views cycle and show. */
  readonly definitions: readonly ProviderDefinition[];
  /** Dashboard, Git, then each provider. */
  views: () => readonly string[];
  get: (id: string) => ProviderDefinition | undefined;
  /** The provider of a settings section or a `:hide` name. */
  byKey: (key: string) => ProviderDefinition | undefined;
  displayName: (view: string) => string;
  /** A provider's own detail tab; null for Git and the Dashboard. */
  detailTab: (view: string) => ProviderTab | null;
  /** A provider's own tab and the ones it adds. */
  tabsOf: (view: string) => readonly ProviderTab[];
  /** The provider a detail tab is of: its own or one it adds. */
  providerOfTab: (tab: string) => ProviderDefinition | undefined;
  /** Whether a view is a provider's: not Git, not the Dashboard. */
  isProvider: (view: string) => boolean;
  /** Each provider's stored Dashboard events for an app: the Dashboard's sources. */
  storedEvents: () => readonly ((app: string) => Promise<DashboardEvent[]>)[];
  /** A provider's adapters, typed by its definition. */
  adapters: <Adapters, Settings extends SettingsSection>(
    definition: ProviderDefinition<Adapters, Settings>,
  ) => Adapters;
}

/** Git's own detail tabs: no provider may take their ids. */
const GIT_TABS = ["files", "info", "stashes", "staged", "unstaged", "untracked"];

/**
 * The set of these providers. One that would collide with another or with the app's own is refused: the same id, the
 * same settings key (also its `:hide` name, so not `git` or `dashboard`), or a detail tab another already has.
 */
export function createProviderSet(entries: readonly ProviderEntry[]): ProviderSet {
  const byId = new Map<string, ProviderEntry>();
  const byKey = new Map<string, ProviderDefinition>();
  const tabs = new Set(GIT_TABS);
  for (const entry of entries) {
    const { id, key, moreTabs = [] } = entry.definition;
    if (id in OWN_VIEWS || byId.has(id)) throw new Error(`Provider "${id}" is registered twice`);
    if (key in OWN_VIEWS) throw new Error(`Provider settings key "${key}" is reserved`);
    if (byKey.has(key)) throw new Error(`Provider settings key "${key}" is registered twice`);
    for (const tab of [id, ...moreTabs.map(added => added.id)]) {
      if (tabs.has(tab)) throw new Error(`Detail tab "${tab}" is used twice`);
      tabs.add(tab);
    }
    byId.set(id, entry);
    byKey.set(key, entry.definition);
  }
  const definitions = entries.map(entry => entry.definition);
  const views = [...Object.keys(OWN_VIEWS), ...definitions.map(definition => definition.id)];
  const get = (id: string) => byId.get(id)?.definition;
  const detailTab = (view: string): ProviderTab | null => {
    const definition = get(view);
    return definition ? { id: definition.id, label: definition.detailLabel ?? definition.displayName } : null;
  };
  return {
    definitions,
    views: () => views,
    get,
    byKey: key => byKey.get(key),
    displayName: view => (OWN_VIEWS as Record<string, string>)[view] ?? get(view)?.displayName ?? view,
    detailTab,
    tabsOf: view => {
      const own = detailTab(view);
      return own ? [own, ...(get(view)?.moreTabs ?? [])] : [];
    },
    isProvider: view => byId.has(view),
    storedEvents: () =>
      entries.flatMap(({ definition, adapters }) =>
        definition.storedEvents
          ? [(app: string) => definition.storedEvents?.(adapters, app) ?? Promise.resolve([])]
          : [],
      ),
    providerOfTab: tab =>
      get(tab) ?? definitions.find(definition => definition.moreTabs?.some(added => added.id === tab)),
    adapters: <Adapters, Settings extends SettingsSection>(definition: ProviderDefinition<Adapters, Settings>) => {
      const entry = byId.get(definition.id);
      if (!entry) throw new Error(`Provider "${definition.id}" is not registered`);
      // The adapters were built for the registered definition: another one with the same id may expect others.
      if ((entry.definition as unknown) !== definition)
        throw new Error(`Provider "${definition.id}" is registered with another definition`);
      return entry.adapters as Adapters;
    },
  };
}
