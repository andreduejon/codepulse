/** The settings of a repository: their shape, defaults, how the settings file is read and checked, and what the app opens with. */

import {
  DASHBOARD_KNOT_MINUTES,
  DASHBOARD_WINDOW_DAYS,
  type DashboardKnotMinutes,
  type DashboardWindowDays,
  DEFAULT_DASHBOARD_SETTINGS,
} from "../dashboard-settings";
import { addDebugEvent } from "../debug-events";
import { normalizeGitHubHost } from "../github/host";
import { isValidJenkinsJobUrl, JENKINS_JOB_URL_MAX_LENGTH } from "../jenkins/validation";
import {
  isValidOpenShiftNamespace,
  isValidOpenShiftServerUrl,
  OPENSHIFT_NAMESPACE_MAX_LENGTH,
  OPENSHIFT_SERVER_URL_MAX_LENGTH,
  OPENSHIFT_TEXT_MAX_LENGTH,
} from "../openshift/validation";
import { PROVIDER_ORDER, type ProviderView } from "../provider-model";
import {
  isProviderAutoRefreshSeconds,
  isProviderCacheLimit,
  isProviderLimit,
  PROVIDER_CACHE_LIMIT_OPTIONS,
  type ProviderCacheLimit,
} from "../provider-settings";

export const GENERAL_TEXT_MAX_LENGTH = 255;

export const REPO_METADATA_MAX_LENGTH = 64;

/**
 * Shape of the config file. All fields are optional —
 * missing fields fall through to CLI args or built-in defaults.
 */
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
  /** Provider-specific configuration. */
  providers?: {
    github?: {
      /** Whether the GitHub Actions provider is enabled. Defaults to false. */
      enabled?: boolean;
      /** Name of the environment variable holding the GitHub Personal Access Token.
       *  Defaults to "GITHUB_TOKEN". */
      tokenEnvVar?: string;
      /** Trusted GitHub Enterprise host for this repo. github.com is always allowed. */
      trustedEnterpriseHost?: string;
      fetchDepth?: 10 | 20 | 50;
      cacheLimit?: ProviderCacheLimit;
      autoRefreshSeconds?: 0 | 120 | 300 | 600;
    };
    jenkins?: {
      enabled?: boolean;
      username?: string;
      tokenEnvVar?: string;
      /** @deprecated Prefer fetchDepth. Still read as fetch-size fallback. */
      graphBuildLimit?: 10 | 20 | 50;
      fetchDepth?: 10 | 20 | 50;
      cacheLimit?: ProviderCacheLimit;
      autoRefreshSeconds?: 0 | 120 | 300 | 600;
      jobs?: { label?: string; url: string }[];
    };
    openshift?: {
      enabled?: boolean;
      serverUrl?: string;
      /** Web console, for opening resources in the browser (`o`). */
      consoleUrl?: string;
      tokenEnvVar?: string;
      namespaces?: string[];
      commitShaAnnotation?: string;
      cacheLimit?: ProviderCacheLimit;
      fetchDepth?: 10 | 20 | 50;
      autoRefreshSeconds?: 0 | 120 | 300 | 600;
    };
    snyk?: {
      enabled?: boolean;
      tokenEnvVar?: string;
      autoScanBranches?: string[];
      maxCachedScans?: ProviderCacheLimit;
    };
  };
}

/** Return the built-in default config (all fields populated). */
export function defaultConfig(): Required<Omit<CodepulseConfig, "branch" | "group" | "appName">> {
  return {
    theme: "catppuccin-mocha",
    pageSize: DEFAULT_MAX_COUNT,
    showAllBranches: true,
    autoRefreshSeconds: DEFAULT_AUTO_REFRESH_INTERVAL / 1000,
    autoFetchSeconds: DEFAULT_AUTO_FETCH_INTERVAL / 1000,
    startView: "git",
    autoFastForward: false,
    dashboard: { ...DEFAULT_DASHBOARD_SETTINGS },
    providers: {
      github: {
        enabled: false,
        tokenEnvVar: "GITHUB_TOKEN",
        trustedEnterpriseHost: undefined,
        fetchDepth: 20,
        cacheLimit: 20,
        autoRefreshSeconds: 120,
      },
      jenkins: {
        enabled: false,
        username: undefined,
        tokenEnvVar: "JENKINS_TOKEN",
        graphBuildLimit: 20,
        fetchDepth: 20,
        cacheLimit: 20,
        autoRefreshSeconds: 120,
        jobs: [],
      },
      openshift: {
        enabled: false,
        serverUrl: "",
        consoleUrl: "",
        tokenEnvVar: "OPENSHIFT_TOKEN",
        namespaces: [],
        commitShaAnnotation: "dev/commit-sha",
        cacheLimit: 20,
        fetchDepth: 20,
        autoRefreshSeconds: 120,
      },
      snyk: {
        enabled: false,
        tokenEnvVar: "SNYK_TOKEN",
        autoScanBranches: [],
        maxCachedScans: 20,
      },
    },
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
export const reportedConfigWarnings = new Set<string>();

/** Puts the config's warnings (a value it ignores, and why) in Debug, each once per run. */
export function reportConfigWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    if (reportedConfigWarnings.has(warning)) continue;
    reportedConfigWarnings.add(warning);
    addDebugEvent({ source: "error", status: "warning", message: warning });
  }
}

/**
 * Validate and sanitize a raw config object. Unknown keys are silently ignored.
 * Invalid values for known keys produce a warning in the provided array.
 */
export function validateConfig(raw: Record<string, unknown>, path: string, warnings: string[]): CodepulseConfig {
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

  const parseTrustedEnterpriseHost = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      warnings.push(`${path}: "providers.github.trustedEnterpriseHost" must be a host string, ignoring`);
      return undefined;
    }
    const host = normalizeGitHubHost(value);
    if (!host || host === "github.com") {
      warnings.push(`${path}: "providers.github.trustedEnterpriseHost" must be a valid non-github.com host, ignoring`);
      return undefined;
    }
    return host;
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
      const providers = raw.providers as Record<string, unknown>;
      config.providers = {};
      if (typeof providers.github === "object" && providers.github !== null && !Array.isArray(providers.github)) {
        const gh = providers.github as Record<string, unknown>;
        config.providers.github = {};
        if (gh.enabled !== undefined) {
          if (typeof gh.enabled === "boolean") {
            config.providers.github.enabled = gh.enabled;
          } else {
            warnings.push(`${path}: "providers.github.enabled" must be a boolean, ignoring`);
          }
        }
        if (gh.tokenEnvVar !== undefined) {
          const tokenEnvVar = parseOptionalText(
            "providers.github.tokenEnvVar",
            gh.tokenEnvVar,
            GENERAL_TEXT_MAX_LENGTH,
          );
          if (tokenEnvVar !== undefined) config.providers.github.tokenEnvVar = tokenEnvVar;
        }
        const trustedEnterpriseHost = parseTrustedEnterpriseHost(gh.trustedEnterpriseHost);
        if (trustedEnterpriseHost !== undefined) {
          config.providers.github.trustedEnterpriseHost = trustedEnterpriseHost;
        }
        if (gh.cacheLimit !== undefined) {
          if (isProviderCacheLimit(gh.cacheLimit)) config.providers.github.cacheLimit = gh.cacheLimit;
          else
            warnings.push(
              `${path}: "providers.github.cacheLimit" must be one of ${PROVIDER_CACHE_LIMIT_OPTIONS.join(", ")}, ignoring`,
            );
        }
        if (gh.fetchDepth !== undefined) {
          if (isProviderLimit(gh.fetchDepth)) config.providers.github.fetchDepth = gh.fetchDepth;
          else warnings.push(`${path}: "providers.github.fetchDepth" must be one of 10, 20, 50, ignoring`);
        }
        if (gh.autoRefreshSeconds !== undefined) {
          if (isProviderAutoRefreshSeconds(gh.autoRefreshSeconds))
            config.providers.github.autoRefreshSeconds = gh.autoRefreshSeconds;
          else
            warnings.push(`${path}: "providers.github.autoRefreshSeconds" must be one of 0, 120, 300, 600, ignoring`);
        }
      }
      if (typeof providers.jenkins === "object" && providers.jenkins !== null && !Array.isArray(providers.jenkins)) {
        const jenkins = providers.jenkins as Record<string, unknown>;
        config.providers.jenkins = {};
        if (jenkins.enabled !== undefined) {
          if (typeof jenkins.enabled === "boolean") config.providers.jenkins.enabled = jenkins.enabled;
          else warnings.push(`${path}: "providers.jenkins.enabled" must be a boolean, ignoring`);
        }
        if (jenkins.username !== undefined) {
          const username = parseOptionalText("providers.jenkins.username", jenkins.username, GENERAL_TEXT_MAX_LENGTH);
          if (username !== undefined) config.providers.jenkins.username = username;
        }
        if (jenkins.tokenEnvVar !== undefined) {
          const tokenEnvVar = parseOptionalText(
            "providers.jenkins.tokenEnvVar",
            jenkins.tokenEnvVar,
            GENERAL_TEXT_MAX_LENGTH,
          );
          if (tokenEnvVar !== undefined) config.providers.jenkins.tokenEnvVar = tokenEnvVar;
        }
        if (jenkins.graphBuildLimit !== undefined) {
          if (isProviderLimit(jenkins.graphBuildLimit))
            config.providers.jenkins.graphBuildLimit = jenkins.graphBuildLimit;
          else warnings.push(`${path}: "providers.jenkins.graphBuildLimit" must be one of 10, 20, 50, ignoring`);
        }
        if (jenkins.cacheLimit !== undefined) {
          if (isProviderCacheLimit(jenkins.cacheLimit)) config.providers.jenkins.cacheLimit = jenkins.cacheLimit;
          else
            warnings.push(
              `${path}: "providers.jenkins.cacheLimit" must be one of ${PROVIDER_CACHE_LIMIT_OPTIONS.join(", ")}, ignoring`,
            );
        }
        if (jenkins.fetchDepth !== undefined) {
          if (isProviderLimit(jenkins.fetchDepth)) config.providers.jenkins.fetchDepth = jenkins.fetchDepth;
          else warnings.push(`${path}: "providers.jenkins.fetchDepth" must be one of 10, 20, 50, ignoring`);
        }
        if (config.providers.jenkins.fetchDepth === undefined && config.providers.jenkins.graphBuildLimit !== undefined)
          config.providers.jenkins.fetchDepth = config.providers.jenkins.graphBuildLimit;
        if (jenkins.autoRefreshSeconds !== undefined) {
          if (isProviderAutoRefreshSeconds(jenkins.autoRefreshSeconds))
            config.providers.jenkins.autoRefreshSeconds = jenkins.autoRefreshSeconds;
          else
            warnings.push(`${path}: "providers.jenkins.autoRefreshSeconds" must be one of 0, 120, 300, 600, ignoring`);
        }
        if (jenkins.jobs !== undefined) {
          if (Array.isArray(jenkins.jobs)) {
            config.providers.jenkins.jobs = jenkins.jobs.flatMap((job, idx) => {
              if (typeof job !== "object" || job === null || Array.isArray(job)) {
                warnings.push(`${path}: "providers.jenkins.jobs[${idx}]" must be an object, ignoring`);
                return [];
              }
              const rawJob = job as Record<string, unknown>;
              const url = parseOptionalText(
                `providers.jenkins.jobs[${idx}].url`,
                rawJob.url,
                JENKINS_JOB_URL_MAX_LENGTH,
              );
              if (url === undefined) {
                return [];
              }
              if (!isValidJenkinsJobUrl(url)) {
                warnings.push(`${path}: "providers.jenkins.jobs[${idx}].url" must be a valid HTTPS URL, ignoring`);
                return [];
              }
              const label = parseOptionalText(
                `providers.jenkins.jobs[${idx}].label`,
                rawJob.label,
                GENERAL_TEXT_MAX_LENGTH,
              );
              return [{ url, ...(label === undefined ? {} : { label }) }];
            });
          } else {
            warnings.push(`${path}: "providers.jenkins.jobs" must be an array, ignoring`);
          }
        }
      }
      if (
        typeof providers.openshift === "object" &&
        providers.openshift !== null &&
        !Array.isArray(providers.openshift)
      ) {
        const openshift = providers.openshift as Record<string, unknown>;
        config.providers.openshift = {};
        if (openshift.enabled !== undefined) {
          if (typeof openshift.enabled === "boolean") config.providers.openshift.enabled = openshift.enabled;
          else warnings.push(`${path}: "providers.openshift.enabled" must be a boolean, ignoring`);
        }
        if (openshift.serverUrl !== undefined) {
          const value = parseOptionalText(
            "providers.openshift.serverUrl",
            openshift.serverUrl,
            OPENSHIFT_SERVER_URL_MAX_LENGTH,
          );
          if (value !== undefined) {
            if (isValidOpenShiftServerUrl(value)) config.providers.openshift.serverUrl = value;
            else warnings.push(`${path}: "providers.openshift.serverUrl" must be a valid HTTPS URL, ignoring`);
          }
        }
        if (openshift.consoleUrl !== undefined) {
          const value = parseOptionalText(
            "providers.openshift.consoleUrl",
            openshift.consoleUrl,
            OPENSHIFT_SERVER_URL_MAX_LENGTH,
          );
          if (value !== undefined) {
            if (isValidOpenShiftServerUrl(value)) config.providers.openshift.consoleUrl = value;
            else warnings.push(`${path}: "providers.openshift.consoleUrl" must be a valid HTTPS URL, ignoring`);
          }
        }
        for (const field of ["tokenEnvVar", "commitShaAnnotation"] as const) {
          if (openshift[field] === undefined) continue;
          const value = parseOptionalText(`providers.openshift.${field}`, openshift[field], OPENSHIFT_TEXT_MAX_LENGTH);
          if (value !== undefined) config.providers.openshift[field] = value;
        }
        if (openshift.cacheLimit !== undefined) {
          if (isProviderCacheLimit(openshift.cacheLimit)) config.providers.openshift.cacheLimit = openshift.cacheLimit;
          else
            warnings.push(
              `${path}: "providers.openshift.cacheLimit" must be one of ${PROVIDER_CACHE_LIMIT_OPTIONS.join(", ")}, ignoring`,
            );
        }
        if (openshift.fetchDepth !== undefined) {
          if (isProviderLimit(openshift.fetchDepth)) config.providers.openshift.fetchDepth = openshift.fetchDepth;
          else warnings.push(`${path}: "providers.openshift.fetchDepth" must be one of 10, 20, 50, ignoring`);
        }
        if (openshift.autoRefreshSeconds !== undefined) {
          if (isProviderAutoRefreshSeconds(openshift.autoRefreshSeconds))
            config.providers.openshift.autoRefreshSeconds = openshift.autoRefreshSeconds;
          else
            warnings.push(
              `${path}: "providers.openshift.autoRefreshSeconds" must be one of 0, 120, 300, 600, ignoring`,
            );
        }
        if (openshift.namespaces !== undefined) {
          if (Array.isArray(openshift.namespaces)) {
            config.providers.openshift.namespaces = openshift.namespaces.flatMap((ns, idx) => {
              const field = `providers.openshift.namespaces[${idx}]`;
              const value = parseOptionalText(field, ns, OPENSHIFT_NAMESPACE_MAX_LENGTH);
              if (value === undefined) return [];
              if (!isValidOpenShiftNamespace(value)) {
                warnings.push(`${path}: "${field}" must be a DNS-1123 label, ignoring`);
                return [];
              }
              return [value];
            });
          } else {
            warnings.push(`${path}: "providers.openshift.namespaces" must be an array, ignoring`);
          }
        }
      }
      if (typeof providers.snyk === "object" && providers.snyk !== null && !Array.isArray(providers.snyk)) {
        const snyk = providers.snyk as Record<string, unknown>;
        config.providers.snyk = {};
        if (snyk.enabled !== undefined) {
          if (typeof snyk.enabled === "boolean") config.providers.snyk.enabled = snyk.enabled;
          else warnings.push(`${path}: "providers.snyk.enabled" must be a boolean, ignoring`);
        }
        if (snyk.tokenEnvVar !== undefined) {
          const tokenEnvVar = parseOptionalText(
            "providers.snyk.tokenEnvVar",
            snyk.tokenEnvVar,
            GENERAL_TEXT_MAX_LENGTH,
          );
          if (tokenEnvVar !== undefined) config.providers.snyk.tokenEnvVar = tokenEnvVar;
        }
        if (snyk.autoScanBranches !== undefined) {
          if (Array.isArray(snyk.autoScanBranches)) {
            config.providers.snyk.autoScanBranches = [
              ...new Set(
                snyk.autoScanBranches.flatMap((branch, idx) => {
                  const value = parseOptionalText(
                    `providers.snyk.autoScanBranches[${idx}]`,
                    branch,
                    GENERAL_TEXT_MAX_LENGTH,
                  );
                  return value === undefined ? [] : [value];
                }),
              ),
            ];
          } else {
            warnings.push(`${path}: "providers.snyk.autoScanBranches" must be an array, ignoring`);
          }
        }
        if (snyk.maxCachedScans !== undefined) {
          if (isProviderCacheLimit(snyk.maxCachedScans)) {
            config.providers.snyk.maxCachedScans = snyk.maxCachedScans;
          } else {
            warnings.push(
              `${path}: "providers.snyk.maxCachedScans" must be one of ${PROVIDER_CACHE_LIMIT_OPTIONS.join(", ")}, ignoring`,
            );
          }
        }
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
    if ((PROVIDER_ORDER as readonly unknown[]).includes(raw.startView))
      config.startView = raw.startView as ProviderView;
    else warnings.push(`${path}: "startView" must be one of ${PROVIDER_ORDER.join(", ")}, ignoring`);
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
export function startViewFor(config: CodepulseConfig): ProviderView {
  const view = config.startView ?? "git";
  switch (view) {
    case "dashboard":
      return config.dashboard?.enabled === false ? "git" : view;
    case "git":
      return view;
    case "github-actions":
      return config.providers?.github?.enabled === true ? view : "git";
    case "jenkins":
      return config.providers?.jenkins?.enabled === true ? view : "git";
    case "openshift":
      return config.providers?.openshift?.enabled === true ? view : "git";
    case "snyk":
      return config.providers?.snyk?.enabled === true ? view : "git";
  }
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
    // Deep-merge providers into existing target.providers to preserve other provider configs
    const existingProviders =
      typeof target.providers === "object" && target.providers !== null && !Array.isArray(target.providers)
        ? { ...(target.providers as Record<string, unknown>) }
        : {};
    if (config.providers.github !== undefined) {
      const existingGitHub =
        typeof existingProviders.github === "object" &&
        existingProviders.github !== null &&
        !Array.isArray(existingProviders.github)
          ? { ...(existingProviders.github as Record<string, unknown>) }
          : {};
      if (config.providers.github.enabled !== undefined) existingGitHub.enabled = config.providers.github.enabled;
      if (config.providers.github.tokenEnvVar !== undefined)
        existingGitHub.tokenEnvVar = config.providers.github.tokenEnvVar;
      if (config.providers.github.trustedEnterpriseHost !== undefined)
        existingGitHub.trustedEnterpriseHost = config.providers.github.trustedEnterpriseHost;
      if (config.providers.github.fetchDepth !== undefined)
        existingGitHub.fetchDepth = config.providers.github.fetchDepth;
      if (config.providers.github.cacheLimit !== undefined)
        existingGitHub.cacheLimit = config.providers.github.cacheLimit;
      if (config.providers.github.autoRefreshSeconds !== undefined)
        existingGitHub.autoRefreshSeconds = config.providers.github.autoRefreshSeconds;
      existingProviders.github = existingGitHub;
    }
    if (config.providers.jenkins !== undefined) {
      const existingJenkins =
        typeof existingProviders.jenkins === "object" &&
        existingProviders.jenkins !== null &&
        !Array.isArray(existingProviders.jenkins)
          ? { ...(existingProviders.jenkins as Record<string, unknown>) }
          : {};
      if (config.providers.jenkins.enabled !== undefined) existingJenkins.enabled = config.providers.jenkins.enabled;
      if (config.providers.jenkins.username !== undefined) existingJenkins.username = config.providers.jenkins.username;
      if (config.providers.jenkins.tokenEnvVar !== undefined)
        existingJenkins.tokenEnvVar = config.providers.jenkins.tokenEnvVar;
      if (config.providers.jenkins.graphBuildLimit !== undefined)
        existingJenkins.graphBuildLimit = config.providers.jenkins.graphBuildLimit;
      if (config.providers.jenkins.fetchDepth !== undefined)
        existingJenkins.fetchDepth = config.providers.jenkins.fetchDepth;
      if (config.providers.jenkins.cacheLimit !== undefined)
        existingJenkins.cacheLimit = config.providers.jenkins.cacheLimit;
      if (config.providers.jenkins.autoRefreshSeconds !== undefined)
        existingJenkins.autoRefreshSeconds = config.providers.jenkins.autoRefreshSeconds;
      if (config.providers.jenkins.jobs !== undefined) existingJenkins.jobs = config.providers.jenkins.jobs;
      existingProviders.jenkins = existingJenkins;
    }
    if (config.providers.openshift !== undefined) {
      const existingOpenShift =
        typeof existingProviders.openshift === "object" &&
        existingProviders.openshift !== null &&
        !Array.isArray(existingProviders.openshift)
          ? { ...(existingProviders.openshift as Record<string, unknown>) }
          : {};
      if (config.providers.openshift.enabled !== undefined)
        existingOpenShift.enabled = config.providers.openshift.enabled;
      if (config.providers.openshift.serverUrl !== undefined)
        existingOpenShift.serverUrl = config.providers.openshift.serverUrl;
      if (config.providers.openshift.consoleUrl !== undefined)
        existingOpenShift.consoleUrl = config.providers.openshift.consoleUrl;
      if (config.providers.openshift.tokenEnvVar !== undefined)
        existingOpenShift.tokenEnvVar = config.providers.openshift.tokenEnvVar;
      if (config.providers.openshift.namespaces !== undefined)
        existingOpenShift.namespaces = config.providers.openshift.namespaces;
      if (config.providers.openshift.commitShaAnnotation !== undefined)
        existingOpenShift.commitShaAnnotation = config.providers.openshift.commitShaAnnotation;
      if (config.providers.openshift.cacheLimit !== undefined)
        existingOpenShift.cacheLimit = config.providers.openshift.cacheLimit;
      if (config.providers.openshift.fetchDepth !== undefined)
        existingOpenShift.fetchDepth = config.providers.openshift.fetchDepth;
      if (config.providers.openshift.autoRefreshSeconds !== undefined)
        existingOpenShift.autoRefreshSeconds = config.providers.openshift.autoRefreshSeconds;
      existingProviders.openshift = existingOpenShift;
    }
    if (config.providers.snyk !== undefined) {
      const existingSnyk =
        typeof existingProviders.snyk === "object" &&
        existingProviders.snyk !== null &&
        !Array.isArray(existingProviders.snyk)
          ? { ...(existingProviders.snyk as Record<string, unknown>) }
          : {};
      if (config.providers.snyk.enabled !== undefined) existingSnyk.enabled = config.providers.snyk.enabled;
      if (config.providers.snyk.tokenEnvVar !== undefined) existingSnyk.tokenEnvVar = config.providers.snyk.tokenEnvVar;
      if (config.providers.snyk.autoScanBranches !== undefined)
        existingSnyk.autoScanBranches = config.providers.snyk.autoScanBranches;
      if (config.providers.snyk.maxCachedScans !== undefined)
        existingSnyk.maxCachedScans = config.providers.snyk.maxCachedScans;
      existingProviders.snyk = existingSnyk;
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
): CodepulseConfig {
  const entry = reposOf(document)?.[repoKey];
  return isRecord(entry) ? validateConfig(entry, `${source} [repos]`, warnings) : {};
}

/** Every repository the document holds, with its group and app name. */
export function knownReposIn(document: Record<string, unknown>, source: string, warnings: string[]): KnownRepoInfo[] {
  return Object.entries(reposOf(document) ?? {}).map(([path, entry]) => {
    if (!isRecord(entry)) return { path };
    const config = validateConfig(entry, `${source} [repos]`, warnings);
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
export function missingDefaults(existing: CodepulseConfig): CodepulseConfig | null {
  const defaults = defaultConfig();

  // Build a partial config containing only the fields missing from the existing entry
  const missing: CodepulseConfig = {};

  if (existing.theme === undefined) missing.theme = defaults.theme;
  if (existing.pageSize === undefined) missing.pageSize = defaults.pageSize;
  if (existing.showAllBranches === undefined) missing.showAllBranches = defaults.showAllBranches;
  if (existing.autoRefreshSeconds === undefined) missing.autoRefreshSeconds = defaults.autoRefreshSeconds;
  if (existing.autoFetchSeconds === undefined) missing.autoFetchSeconds = defaults.autoFetchSeconds;

  const existingGitHub = existing.providers?.github;
  const defaultGh = defaults.providers.github ?? {
    enabled: false,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: undefined,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
  };
  if (
    existingGitHub?.enabled === undefined ||
    existingGitHub?.tokenEnvVar === undefined ||
    existingGitHub?.trustedEnterpriseHost === undefined ||
    existingGitHub?.fetchDepth === undefined ||
    existingGitHub?.cacheLimit === undefined ||
    existingGitHub?.autoRefreshSeconds === undefined
  ) {
    missing.providers = {
      github: {
        ...(existingGitHub?.enabled === undefined ? { enabled: defaultGh.enabled } : {}),
        ...(existingGitHub?.tokenEnvVar === undefined ? { tokenEnvVar: defaultGh.tokenEnvVar } : {}),
        ...(existingGitHub?.trustedEnterpriseHost === undefined
          ? { trustedEnterpriseHost: defaultGh.trustedEnterpriseHost }
          : {}),
        ...(existingGitHub?.fetchDepth === undefined ? { fetchDepth: defaultGh.fetchDepth } : {}),
        ...(existingGitHub?.cacheLimit === undefined ? { cacheLimit: defaultGh.cacheLimit } : {}),
        ...(existingGitHub?.autoRefreshSeconds === undefined
          ? { autoRefreshSeconds: defaultGh.autoRefreshSeconds }
          : {}),
      },
    };
  }

  const existingJenkins = existing.providers?.jenkins;
  const defaultJenkins = defaults.providers.jenkins ?? {
    enabled: false,
    tokenEnvVar: "JENKINS_TOKEN",
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
    jobs: [],
  };
  const jenkinsFetchDepth = existingJenkins?.fetchDepth ?? existingJenkins?.graphBuildLimit;
  if (
    existingJenkins?.enabled === undefined ||
    existingJenkins?.tokenEnvVar === undefined ||
    jenkinsFetchDepth === undefined ||
    existingJenkins?.cacheLimit === undefined ||
    existingJenkins?.autoRefreshSeconds === undefined ||
    existingJenkins?.jobs === undefined
  ) {
    missing.providers = {
      ...missing.providers,
      jenkins: {
        ...(existingJenkins?.enabled === undefined ? { enabled: defaultJenkins.enabled } : {}),
        ...(existingJenkins?.tokenEnvVar === undefined ? { tokenEnvVar: defaultJenkins.tokenEnvVar } : {}),
        ...(existingJenkins?.fetchDepth === undefined
          ? { fetchDepth: jenkinsFetchDepth ?? defaultJenkins.fetchDepth }
          : {}),
        ...(existingJenkins?.cacheLimit === undefined ? { cacheLimit: defaultJenkins.cacheLimit } : {}),
        ...(existingJenkins?.autoRefreshSeconds === undefined
          ? { autoRefreshSeconds: defaultJenkins.autoRefreshSeconds }
          : {}),
        ...(existingJenkins?.jobs === undefined ? { jobs: defaultJenkins.jobs } : {}),
      },
    };
  }

  const existingOpenShift = existing.providers?.openshift;
  const defaultOpenShift = defaults.providers.openshift ?? {
    enabled: false,
    serverUrl: undefined,
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: [],
    commitShaAnnotation: undefined,
    cacheLimit: 20,
    fetchDepth: 20,
    autoRefreshSeconds: 120,
  };
  if (
    existingOpenShift?.enabled === undefined ||
    existingOpenShift?.serverUrl === undefined ||
    existingOpenShift?.tokenEnvVar === undefined ||
    existingOpenShift?.namespaces === undefined ||
    existingOpenShift?.commitShaAnnotation === undefined ||
    existingOpenShift?.cacheLimit === undefined ||
    existingOpenShift?.fetchDepth === undefined ||
    existingOpenShift?.autoRefreshSeconds === undefined
  ) {
    missing.providers = {
      ...missing.providers,
      openshift: {
        ...(existingOpenShift?.enabled === undefined ? { enabled: defaultOpenShift.enabled } : {}),
        ...(existingOpenShift?.serverUrl === undefined ? { serverUrl: defaultOpenShift.serverUrl } : {}),
        ...(existingOpenShift?.tokenEnvVar === undefined ? { tokenEnvVar: defaultOpenShift.tokenEnvVar } : {}),
        ...(existingOpenShift?.namespaces === undefined ? { namespaces: defaultOpenShift.namespaces } : {}),
        ...(existingOpenShift?.commitShaAnnotation === undefined
          ? { commitShaAnnotation: defaultOpenShift.commitShaAnnotation }
          : {}),
        ...(existingOpenShift?.cacheLimit === undefined ? { cacheLimit: defaultOpenShift.cacheLimit } : {}),
        ...(existingOpenShift?.fetchDepth === undefined ? { fetchDepth: defaultOpenShift.fetchDepth } : {}),
        ...(existingOpenShift?.autoRefreshSeconds === undefined
          ? { autoRefreshSeconds: defaultOpenShift.autoRefreshSeconds }
          : {}),
      },
    };
  }

  const existingSnyk = existing.providers?.snyk;
  const defaultSnyk = defaults.providers.snyk ?? {
    enabled: false,
    tokenEnvVar: "SNYK_TOKEN",
    autoScanBranches: [],
    maxCachedScans: 20,
  };
  if (
    existingSnyk?.enabled === undefined ||
    existingSnyk?.tokenEnvVar === undefined ||
    existingSnyk?.autoScanBranches === undefined ||
    existingSnyk?.maxCachedScans === undefined
  ) {
    missing.providers = {
      ...missing.providers,
      snyk: {
        ...(existingSnyk?.enabled === undefined ? { enabled: defaultSnyk.enabled } : {}),
        ...(existingSnyk?.tokenEnvVar === undefined ? { tokenEnvVar: defaultSnyk.tokenEnvVar } : {}),
        ...(existingSnyk?.autoScanBranches === undefined ? { autoScanBranches: defaultSnyk.autoScanBranches } : {}),
        ...(existingSnyk?.maxCachedScans === undefined ? { maxCachedScans: defaultSnyk.maxCachedScans } : {}),
      },
    };
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
