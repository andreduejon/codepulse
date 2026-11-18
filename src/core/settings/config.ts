/** The settings of a repository: their shape, defaults, how the settings file is read and checked, and what the app opens with. */

import {
  DASHBOARD_KNOT_MINUTES,
  DASHBOARD_WINDOW_DAYS,
  type DashboardKnotMinutes,
  type DashboardWindowDays,
  DEFAULT_DASHBOARD_SETTINGS,
} from "../dashboard-settings";
import { type DebugLog, debugLog } from "../debug-events";
import type { ProviderView } from "../provider-model";
import type { ProviderDefinition } from "../provider-set";
import { missingSettings, type SettingsSection, sectionReader } from "./provider-section";

/** The providers whose sections the settings hold: their definitions, from the app's provider set. */
type Providers = readonly ProviderDefinition[];

export const GENERAL_TEXT_MAX_LENGTH = 255;

export const REPO_METADATA_MAX_LENGTH = 64;

/**
 * Shape of the config file. All fields are optional —
 * missing fields fall through to CLI args or built-in defaults.
 */
/** A provider's section as the settings hold it: what else is in it is its provider's definition's. */
export type ProviderSection = SettingsSection & { readonly [field: string]: unknown };

/** A provider's section, typed by its definition; undefined when the settings have none. */
export function providerSettings<Settings extends SettingsSection>(
  config: CodepulseConfig,
  definition: ProviderDefinition<never, Settings>,
): Partial<Settings> | undefined {
  return config.providers?.[definition.key] as Partial<Settings> | undefined;
}

export interface CodepulseConfig {
  group?: string;
  appName?: string;
  theme?: string;
  pageSize?: number;
  branch?: string;
  showAllBranches?: boolean;
  /** Auto-refresh interval in seconds. 0 = off. */
  autoRefreshSeconds?: number;
  /** Auto-fetch interval in seconds. 0 = off. */
  autoFetchSeconds?: number;
  /** The view codepulse opens in: Git by default, the dashboard or a provider that is turned on. */
  startView?: ProviderView;
  /** `f` and Auto fetch also fast-forward the branches that are only behind their remote branch. Off by default. */
  autoFastForward?: boolean;
  /** The dashboard: whether it shows (on by default), how many days back it reads, how many minutes one knot holds. */
  dashboard?: {
    enabled?: boolean;
    windowDays?: DashboardWindowDays;
    knotMinutes?: DashboardKnotMinutes;
  };
  /**
   * Each provider's section by its key (`github`, `jenkins`): what a section holds is its provider's definition's
   * (core/<provider>/definition.ts). Read one typed with providerSettings.
   */
  providers?: Partial<Record<string, ProviderSection>>;
}

/** Return the built-in default config (all fields populated): each provider's section from its definition. */
export function defaultConfig(
  providers: Providers = [],
): Required<Omit<CodepulseConfig, "branch" | "group" | "appName">> {
  return {
    theme: "catppuccin-mocha",
    pageSize: DEFAULT_MAX_COUNT,
    showAllBranches: true,
    autoRefreshSeconds: DEFAULT_AUTO_REFRESH_INTERVAL / 1000,
    autoFetchSeconds: DEFAULT_AUTO_FETCH_INTERVAL / 1000,
    startView: "git",
    autoFastForward: false,
    dashboard: { ...DEFAULT_DASHBOARD_SETTINGS },
    providers: Object.fromEntries(
      providers.map(provider => [provider.key, { ...provider.settings.defaults } as ProviderSection]),
    ),
  };
}

/** Resolved options ready for the app (all fields required). */
export interface AppOptions {
  repoPath: string;
  branch: string | undefined;
  all: boolean;
  maxCount: number;
  themeName: string;
  autoRefreshInterval: number;
  autoFetchInterval: number;
}

/** Information about the global config file and repo-specific overrides. */
export interface ConfigInfo {
  /** Absolute path to the global config file. */
  globalPath: string;
  /** Whether the global config file exists on disk. */
  globalExists: boolean;
  /** Whether the current repo has specific overrides in the config. */
  hasRepoOverrides: boolean;
  /** Non-fatal warnings encountered while reading/validating the config. */
  warnings: string[];
}

export interface KnownRepoInfo {
  path: string;
  group?: string;
  appName?: string;
}

/** The warnings already in Debug: the config is read again on every reload and repository switch. */
/** Puts the config's warnings (a value it ignores, and why) in Debug, each once per run. */
export function reportConfigWarnings(warnings: readonly string[], log: DebugLog = debugLog): void {
  for (const warning of warnings) log.addOnce({ source: "error", status: "warning", message: warning });
}

/**
 * Validate and sanitize a raw config object. Unknown keys are silently ignored.
 * Invalid values for known keys produce a warning in the provided array.
 */
export function validateConfig(
  raw: Record<string, unknown>,
  path: string,
  warnings: string[],
  providers: Providers,
): CodepulseConfig {
  const config: CodepulseConfig = {};

  const parseOptionalText = (field: string, value: unknown, maxLength: number): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      warnings.push(`${path}: "${field}" must be a string, ignoring`);
      return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.length > maxLength) {
      warnings.push(`${path}: "${field}" must be at most ${maxLength} characters, ignoring`);
      return undefined;
    }
    return trimmed;
  };

  const group = parseOptionalText("group", raw.group, REPO_METADATA_MAX_LENGTH);
  if (group !== undefined) config.group = group;

  const appName = parseOptionalText("appName", raw.appName, REPO_METADATA_MAX_LENGTH);
  if (appName !== undefined) config.appName = appName;

  if (raw.theme !== undefined) {
    const theme = parseOptionalText("theme", raw.theme, GENERAL_TEXT_MAX_LENGTH);
    if (theme !== undefined) config.theme = theme;
  }

  if (raw.pageSize !== undefined) {
    if (typeof raw.pageSize === "number" && Number.isInteger(raw.pageSize) && raw.pageSize >= 1) {
      config.pageSize = raw.pageSize;
    } else {
      warnings.push(`${path}: "pageSize" must be a positive integer, ignoring`);
    }
  }

  if (raw.branch !== undefined) {
    const branch = parseOptionalText("branch", raw.branch, GENERAL_TEXT_MAX_LENGTH);
    if (branch !== undefined) config.branch = branch;
  }

  if (raw.showAllBranches !== undefined) {
    if (typeof raw.showAllBranches === "boolean") {
      config.showAllBranches = raw.showAllBranches;
    } else {
      warnings.push(`${path}: "showAllBranches" must be a boolean, ignoring`);
    }
  }

  if (raw.autoRefreshSeconds !== undefined) {
    if (typeof raw.autoRefreshSeconds === "number" && raw.autoRefreshSeconds >= 0) {
      config.autoRefreshSeconds = raw.autoRefreshSeconds;
    } else {
      warnings.push(`${path}: "autoRefreshSeconds" must be a non-negative number, ignoring`);
    }
  }

  if (raw.autoFetchSeconds !== undefined) {
    if (typeof raw.autoFetchSeconds === "number" && raw.autoFetchSeconds >= 0) {
      config.autoFetchSeconds = raw.autoFetchSeconds;
    } else {
      warnings.push(`${path}: "autoFetchSeconds" must be a non-negative number, ignoring`);
    }
  }

  if (raw.providers !== undefined) {
    if (typeof raw.providers === "object" && raw.providers !== null && !Array.isArray(raw.providers)) {
      const sections = raw.providers as Record<string, unknown>;
      config.providers = {};
      for (const provider of providers) {
        const section = sections[provider.key];
        if (typeof section !== "object" || section === null || Array.isArray(section)) continue;
        config.providers[provider.key] = provider.settings.read(
          section as Record<string, unknown>,
          sectionReader(path, provider.key, warnings),
        ) as ProviderSection;
      }
    } else {
      warnings.push(`${path}: "providers" must be an object, ignoring`);
    }
  }

  if (raw.autoFastForward !== undefined) {
    if (typeof raw.autoFastForward === "boolean") config.autoFastForward = raw.autoFastForward;
    else warnings.push(`${path}: "autoFastForward" must be a boolean, ignoring`);
  }

  if (raw.startView !== undefined) {
    const views = ["dashboard", "git", ...providers.map(provider => provider.id)];
    if (typeof raw.startView === "string" && views.includes(raw.startView)) config.startView = raw.startView;
    else warnings.push(`${path}: "startView" must be one of ${views.join(", ")}, ignoring`);
  }

  if (raw.dashboard !== undefined) {
    if (typeof raw.dashboard === "object" && raw.dashboard !== null && !Array.isArray(raw.dashboard)) {
      const dashboard = raw.dashboard as Record<string, unknown>;
      config.dashboard = {};
      if (dashboard.enabled !== undefined) {
        if (typeof dashboard.enabled === "boolean") config.dashboard.enabled = dashboard.enabled;
        else warnings.push(`${path}: "dashboard.enabled" must be a boolean, ignoring`);
      }
      if (dashboard.windowDays !== undefined) {
        if ((DASHBOARD_WINDOW_DAYS as readonly unknown[]).includes(dashboard.windowDays))
          config.dashboard.windowDays = dashboard.windowDays as DashboardWindowDays;
        else
          warnings.push(`${path}: "dashboard.windowDays" must be one of ${DASHBOARD_WINDOW_DAYS.join(", ")}, ignoring`);
      }
      if (dashboard.knotMinutes !== undefined) {
        if ((DASHBOARD_KNOT_MINUTES as readonly unknown[]).includes(dashboard.knotMinutes))
          config.dashboard.knotMinutes = dashboard.knotMinutes as DashboardKnotMinutes;
        else
          warnings.push(
            `${path}: "dashboard.knotMinutes" must be one of ${DASHBOARD_KNOT_MINUTES.join(", ")}, ignoring`,
          );
      }
    } else {
      warnings.push(`${path}: "dashboard" must be an object, ignoring`);
    }
  }

  return config;
}

/** The view a repository opens in: its `startView` while that provider is turned on, else Git. */
export function startViewFor(config: CodepulseConfig, providers: Providers): ProviderView {
  const view = config.startView ?? "git";
  if (view === "dashboard") return config.dashboard?.enabled === false ? "git" : view;
  const provider = providers.find(candidate => candidate.id === view);
  if (!provider) return "git";
  return config.providers?.[provider.key]?.enabled === true ? view : "git";
}

/**
 * Merge config file values with CLI options.
 * Priority: CLI (explicit) > config file > built-in defaults.
 */
export function mergeOptions(cli: { repoPath: string }, config: CodepulseConfig): AppOptions {
  const defaults = defaultConfig();
  const branch = config.branch;
  const all = branch === undefined ? (config.showAllBranches ?? true) : false;

  return {
    repoPath: cli.repoPath,
    branch,
    all,
    maxCount: config.pageSize ?? defaults.pageSize,
    themeName: config.theme ?? defaults.theme,
    autoRefreshInterval:
      config.autoRefreshSeconds === undefined ? defaults.autoRefreshSeconds * 1000 : config.autoRefreshSeconds * 1000,
    autoFetchInterval:
      config.autoFetchSeconds === undefined ? defaults.autoFetchSeconds * 1000 : config.autoFetchSeconds * 1000,
  };
}

/** Apply defined CodepulseConfig fields to a target object. */
export function applyConfigFields(target: Record<string, unknown>, config: CodepulseConfig): void {
  if (config.group !== undefined) target.group = config.group;
  if (config.appName !== undefined) target.appName = config.appName;
  if (config.theme !== undefined) target.theme = config.theme;
  if (config.pageSize !== undefined) target.pageSize = config.pageSize;
  if (config.branch !== undefined) target.branch = config.branch;
  if (config.showAllBranches !== undefined) target.showAllBranches = config.showAllBranches;
  if (config.autoRefreshSeconds !== undefined) target.autoRefreshSeconds = config.autoRefreshSeconds;
  if (config.autoFetchSeconds !== undefined) target.autoFetchSeconds = config.autoFetchSeconds;
  if (config.startView !== undefined) target.startView = config.startView;
  if (config.autoFastForward !== undefined) target.autoFastForward = config.autoFastForward;
  if (config.dashboard !== undefined) {
    const existing =
      typeof target.dashboard === "object" && target.dashboard !== null && !Array.isArray(target.dashboard)
        ? (target.dashboard as Record<string, unknown>)
        : {};
    target.dashboard = {
      ...existing,
      ...(config.dashboard.enabled !== undefined ? { enabled: config.dashboard.enabled } : {}),
      ...(config.dashboard.windowDays !== undefined ? { windowDays: config.dashboard.windowDays } : {}),
      ...(config.dashboard.knotMinutes !== undefined ? { knotMinutes: config.dashboard.knotMinutes } : {}),
    };
  }
  if (config.providers !== undefined) {
    // Each provider's fields go into its section, keeping the other providers and the fields not given.
    const existingProviders = isRecord(target.providers) ? { ...target.providers } : {};
    for (const [key, section] of Object.entries(config.providers)) {
      if (section === undefined) continue;
      const existing = isRecord(existingProviders[key]) ? { ...existingProviders[key] } : {};
      for (const [field, value] of Object.entries(section)) if (value !== undefined) existing[field] = value;
      existingProviders[key] = existing;
    }
    target.providers = existingProviders;
  }
}

/** Default number of commits to load when repo config does not override page size. */
export const DEFAULT_MAX_COUNT = 200;

export const DEFAULT_AUTO_REFRESH_INTERVAL = 30000;

export const DEFAULT_AUTO_FETCH_INTERVAL = 0;

// ── The settings document: { repos: { [absolute repository path]: settings } } ──

/** A plain object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The settings document's repositories, or none. */
function reposOf(document: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(document.repos) ? document.repos : null;
}

/** Whether the document holds settings for a repository (by its absolute path). */
export function hasRepoSettings(document: Record<string, unknown>, repoKey: string): boolean {
  const repos = reposOf(document);
  return !!repos && repoKey in repos;
}

/** A repository's settings from the document, checked: what is wrong is left out and named in `warnings`. */
export function repoSettingsIn(
  document: Record<string, unknown>,
  repoKey: string,
  source: string,
  warnings: string[],
  providers: Providers,
): CodepulseConfig {
  const entry = reposOf(document)?.[repoKey];
  return isRecord(entry) ? validateConfig(entry, `${source} [repos]`, warnings, providers) : {};
}

/** Every repository the document holds, with its group and app name. */
export function knownReposIn(document: Record<string, unknown>, source: string, warnings: string[]): KnownRepoInfo[] {
  return Object.entries(reposOf(document) ?? {}).map(([path, entry]) => {
    if (!isRecord(entry)) return { path };
    // Only the group and the app name: no provider's section is read.
    const config = validateConfig(entry, `${source} [repos]`, warnings, []);
    return {
      path,
      ...(config.group === undefined ? {} : { group: config.group }),
      ...(config.appName === undefined ? {} : { appName: config.appName }),
    };
  });
}

/** The document with a repository's settings changed: the fields `config` sets, the rest as they were. */
export function withRepoSettings(
  document: Record<string, unknown>,
  repoKey: string,
  config: CodepulseConfig,
): Record<string, unknown> {
  const repos = { ...(reposOf(document) ?? {}) };
  const entry: Record<string, unknown> = isRecord(repos[repoKey]) ? { ...(repos[repoKey] as object) } : {};
  applyConfigFields(entry, config);
  repos[repoKey] = entry;
  return { ...document, repos };
}

/** The document without a repository's settings (and without `repos` when it was the last). */
export function withoutRepoSettings(document: Record<string, unknown>, repoKey: string): Record<string, unknown> {
  const repos = reposOf(document);
  if (!repos) return document;
  const next = { ...repos };
  delete next[repoKey];
  const result = { ...document };
  if (Object.keys(next).length === 0) delete result.repos;
  else result.repos = next;
  return result;
}

/**
 * The settings a repository lacks, from the defaults: what to write so the file shows every setting. Never a value
 * the repository already has. Null when nothing is missing.
 */
export function missingDefaults(existing: CodepulseConfig, providers: Providers): CodepulseConfig | null {
  const defaults = defaultConfig();

  // Build a partial config containing only the fields missing from the existing entry
  const missing: CodepulseConfig = {};

  if (existing.theme === undefined) missing.theme = defaults.theme;
  if (existing.pageSize === undefined) missing.pageSize = defaults.pageSize;
  if (existing.showAllBranches === undefined) missing.showAllBranches = defaults.showAllBranches;
  if (existing.autoRefreshSeconds === undefined) missing.autoRefreshSeconds = defaults.autoRefreshSeconds;
  if (existing.autoFetchSeconds === undefined) missing.autoFetchSeconds = defaults.autoFetchSeconds;

  for (const provider of providers) {
    const section = missingSettings(provider.settings, existing.providers?.[provider.key]);
    if (section) missing.providers = { ...missing.providers, [provider.key]: section as ProviderSection };
  }

  const hasAnyMissing =
    missing.theme !== undefined ||
    missing.pageSize !== undefined ||
    missing.showAllBranches !== undefined ||
    missing.autoRefreshSeconds !== undefined ||
    missing.autoFetchSeconds !== undefined ||
    missing.providers !== undefined;

  return hasAnyMissing ? missing : null;
}
