/**
 * The open repository's settings: each provider's, the Dashboard's, the start view, Auto fast-forward, the app's
 * name and group, and its theme. Read once at startup and again whenever another repository opens; a value the config
 * can't use goes to Debug. The Menu changes them through the setters.
 */
import { type Accessor, createEffect, createSignal, type Setter, untrack } from "solid-js";
import { githubSettings, jenkinsSettings, openShiftSettings, snykSettings } from "../app-provider-config";
import type { AppContentProps } from "../app-types";
import {
  type CodepulseConfig,
  defaultConfig,
  getRepoDisplayConfig,
  loadConfig,
  reportConfigWarnings,
  startViewFor,
} from "../config";
import { backfillRepoConfig } from "../config-write";
import type { AppActions, AppState } from "../context/state";
import type { createThemeState } from "../context/theme";
import { dashboardSettings } from "../dashboard/settings";
import type { ProviderView } from "../providers/provider";
import type { SnykProviderConfig } from "../providers/snyk/use-snyk";

type ThemeState = ReturnType<typeof createThemeState>;

export interface RepoSettings {
  github: Accessor<ReturnType<typeof githubSettings>>;
  setGithub: Setter<ReturnType<typeof githubSettings>>;
  jenkins: Accessor<ReturnType<typeof jenkinsSettings>>;
  setJenkins: Setter<ReturnType<typeof jenkinsSettings>>;
  openShift: Accessor<ReturnType<typeof openShiftSettings>>;
  setOpenShift: Setter<ReturnType<typeof openShiftSettings>>;
  snyk: Accessor<SnykProviderConfig>;
  setSnyk: Setter<SnykProviderConfig>;
  dashboard: Accessor<ReturnType<typeof dashboardSettings>>;
  setDashboard: Setter<ReturnType<typeof dashboardSettings>>;
  /** The view this repository opens in, as Menu → Providers → Start in shows it. */
  startView: Accessor<ProviderView>;
  setStartView: Setter<ProviderView>;
  /** Menu → Repository → Preferences → Auto fast-forward: `f` and Auto fetch fast-forward too. */
  autoFastForward: Accessor<boolean>;
  setAutoFastForward: Setter<boolean>;
  /** The app's name and group, for the project row and switching within the group. */
  display: Accessor<ReturnType<typeof getRepoDisplayConfig>>;
  setDisplay: Setter<ReturnType<typeof getRepoDisplayConfig>>;
  /** A repository's config; what it ignores goes to Debug. */
  read: (path: string) => CodepulseConfig;
  /** Reads the open repository's settings again (`:reload` and Menu → Reload). */
  reload: () => void;
}

export function useRepoSettings(opts: {
  repoPath: Accessor<string>;
  initial: Pick<
    AppContentProps,
    "initialGithubConfig" | "initialJenkinsConfig" | "initialOpenShiftConfig" | "initialSnykConfig"
  >;
  themeState: ThemeState;
  state: AppState;
  actions: AppActions;
}): RepoSettings {
  const { state, actions, themeState } = opts;
  const read = (path: string) => {
    const { config, warnings } = loadConfig(path);
    reportConfigWarnings(warnings);
    return config;
  };
  const [github, setGithub] = createSignal(githubSettings(opts.initial.initialGithubConfig));
  const [jenkins, setJenkins] = createSignal(jenkinsSettings(opts.initial.initialJenkinsConfig));
  const [openShift, setOpenShift] = createSignal(openShiftSettings(opts.initial.initialOpenShiftConfig));
  const [snyk, setSnyk] = createSignal<SnykProviderConfig>(snykSettings(opts.initial.initialSnykConfig));
  const startConfig = read(untrack(opts.repoPath));
  const [dashboard, setDashboard] = createSignal(dashboardSettings(startConfig.dashboard));
  const [startView, setStartView] = createSignal<ProviderView>(startConfig.startView ?? "git");
  const [autoFastForward, setAutoFastForward] = createSignal(startConfig.autoFastForward ?? false);
  const [display, setDisplay] = createSignal(getRepoDisplayConfig(untrack(opts.repoPath)));
  actions.setActiveProviderView(startViewFor(startConfig));

  // Menu → Providers → Dashboard → Enabled, per repository: off, it has no tab, and leaving it shows Git.
  createEffect(() => {
    const enabled = dashboard().enabled;
    state.providers.setDashboardEnabled(enabled);
    if (!enabled && untrack(state.activeProviderView) === "dashboard") actions.setActiveProviderView("git");
  });

  const reload = () => {
    const path = opts.repoPath();
    backfillRepoConfig(path);
    const config = read(path);
    setGithub(githubSettings(config.providers?.github));
    setJenkins(jenkinsSettings(config.providers?.jenkins));
    setOpenShift(openShiftSettings(config.providers?.openshift));
    setSnyk(snykSettings(config.providers?.snyk));
    setDashboard(dashboardSettings(config.dashboard));
    setStartView(config.startView ?? "git");
    setAutoFastForward(config.autoFastForward ?? false);
    setDisplay(getRepoDisplayConfig(path));
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
    github,
    setGithub,
    jenkins,
    setJenkins,
    openShift,
    setOpenShift,
    snyk,
    setSnyk,
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
  };
}
