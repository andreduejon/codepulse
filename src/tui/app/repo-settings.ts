/**
 * The open repository's settings: each provider's, the Dashboard's, the start view, Auto fast-forward, the app's
 * name and group, and its theme. Read once at startup and again whenever another repository opens; a value the config
 * can't use goes to Debug. The Menu changes them through the setters.
 */

import { type Accessor, createEffect, createSignal, type Setter, untrack } from "solid-js";
import { dashboardSettings } from "../../core/dashboard-settings";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderDefinition, ProviderSet } from "../../core/provider-set";
import {
  type CodepulseConfig,
  defaultConfig,
  providerSettings,
  reportConfigWarnings,
  startViewFor,
} from "../../core/settings/config";
import type { SettingsPort } from "../../core/settings/port";
import type { SettingsSection } from "../../core/settings/provider-section";
import type { AppActions, AppState } from "../context/state";
import type { createThemeState } from "../context/theme";

type ThemeState = ReturnType<typeof createThemeState>;

export interface RepoSettings {
  /** A provider's settings, its defaults filled in. */
  of: <Settings extends SettingsSection>(definition: ProviderDefinition<never, Settings>) => Accessor<Settings>;
  /** Changes a provider's settings (the Menu saves them itself). */
  set: <Settings extends SettingsSection>(definition: ProviderDefinition<never, Settings>, next: Settings) => void;
  dashboard: Accessor<ReturnType<typeof dashboardSettings>>;
  setDashboard: Setter<ReturnType<typeof dashboardSettings>>;
  /** The view this repository opens in, as Menu → Providers → Start in shows it. */
  startView: Accessor<ProviderView>;
  setStartView: Setter<ProviderView>;
  /** Menu → Repository → Preferences → Auto fast-forward: `f` and Auto fetch fast-forward too. */
  autoFastForward: Accessor<boolean>;
  setAutoFastForward: Setter<boolean>;
  /** The app's name and group, for the project row and switching within the group. */
  display: Accessor<Pick<CodepulseConfig, "group" | "appName">>;
  setDisplay: Setter<Pick<CodepulseConfig, "group" | "appName">>;
  /** A repository's config; what it ignores goes to Debug. */
  read: (path: string) => CodepulseConfig;
  /** Reads the open repository's settings again (`:reload` and Menu → Reload). */
  reload: () => void;
  /** Where the settings are kept. */
  port: SettingsPort;
}

/** A provider's section with its defaults filled in. */
export function resolvedSettings<Settings extends SettingsSection>(
  definition: ProviderDefinition<never, Settings>,
  config: CodepulseConfig,
): Settings {
  return { ...definition.settings.defaults, ...providerSettings(config, definition) };
}

export function useRepoSettings(opts: {
  repoPath: Accessor<string>;
  /** The providers' settings the app started with (startupProps read them). */
  initial: CodepulseConfig["providers"];
  providers: ProviderSet;
  themeState: ThemeState;
  state: AppState;
  actions: AppActions;
  /** Where the settings are kept. */
  port: SettingsPort;
}): RepoSettings {
  const { state, actions, themeState, providers } = opts;
  const read = (path: string) => {
    const { config, warnings } = opts.port.load(path);
    reportConfigWarnings(warnings);
    return config;
  };
  /** Each provider's settings by its key. */
  const sections = new Map<string, ReturnType<typeof createSignal<SettingsSection>>>(
    providers.definitions.map(definition => [
      definition.key,
      createSignal<SettingsSection>(
        resolvedSettings(definition as ProviderDefinition<never, SettingsSection>, { providers: opts.initial }),
      ),
    ]),
  );
  const section = <Settings extends SettingsSection>(definition: ProviderDefinition<never, Settings>) => {
    const found = sections.get(definition.key);
    if (!found) throw new Error(`Provider "${definition.id}" is not in the app's provider set`);
    return found;
  };
  const startConfig = read(untrack(opts.repoPath));
  const [dashboard, setDashboard] = createSignal(dashboardSettings(startConfig.dashboard));
  const [startView, setStartView] = createSignal<ProviderView>(startConfig.startView ?? "git");
  const [autoFastForward, setAutoFastForward] = createSignal(startConfig.autoFastForward ?? false);
  const [display, setDisplay] = createSignal(opts.port.display(untrack(opts.repoPath)));
  actions.setActiveProviderView(startViewFor(startConfig, providers.definitions));

  // Menu → Providers → Dashboard → Enabled, per repository: off, it has no tab, and leaving it shows Git.
  createEffect(() => {
    const enabled = dashboard().enabled;
    state.providers.setDashboardEnabled(enabled);
    if (!enabled && untrack(state.activeProviderView) === "dashboard") actions.setActiveProviderView("git");
  });

  const reload = () => {
    const path = opts.repoPath();
    opts.port.backfill(path);
    const config = read(path);
    for (const definition of providers.definitions)
      section(definition)[1](resolvedSettings(definition as ProviderDefinition<never, SettingsSection>, config));
    setDashboard(dashboardSettings(config.dashboard));
    setStartView(config.startView ?? "git");
    setAutoFastForward(config.autoFastForward ?? false);
    setDisplay(opts.port.display(path));
    // The theme is per repository; without this a switch keeps the previous repo's theme, and the next settings
    // change saves it into this one. An unknown theme falls back to the default, as at startup.
    const theme = config.theme ?? defaultConfig().theme;
    themeState.setTheme(Object.hasOwn(themeState.themes, theme) ? theme : defaultConfig().theme);
  };
  // Another repository: its settings, with the missing keys written into its config so they can be edited there.
  createEffect(() => {
    opts.repoPath();
    reload();
  });

  return {
    of: <Settings extends SettingsSection>(definition: ProviderDefinition<never, Settings>) =>
      section(definition)[0] as Accessor<Settings>,
    set: (definition, next) => section(definition)[1](() => next),
    dashboard,
    setDashboard,
    startView,
    setStartView,
    autoFastForward,
    setAutoFastForward,
    display,
    setDisplay,
    read,
    reload,
    port: opts.port,
  };
}
