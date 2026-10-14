import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type CodepulseConfig, defaultConfig, defaultConfigPath, loadConfig } from "./config";

/**
 * Backfill missing config keys for the current repo on startup.
 *
 * Reads the current repo entry, deep-merges with defaults writing back
 * **only the keys that are missing** — never overwrites existing values.
 * Other repos and other keys are left untouched.
 *
 * @param repoPath - The repository directory (absolute path).
 * @param configPath - Override the global config path (used by tests).
 */
export function backfillRepoConfig(repoPath: string, configPath?: string): void {
  const { config: existing } = loadConfig(repoPath, configPath);
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

  // Only write if there is anything missing
  const hasAnyMissing =
    missing.theme !== undefined ||
    missing.pageSize !== undefined ||
    missing.showAllBranches !== undefined ||
    missing.autoRefreshSeconds !== undefined ||
    missing.autoFetchSeconds !== undefined ||
    missing.providers !== undefined;

  if (hasAnyMissing) {
    writeConfig(missing, repoPath, configPath);
  }
}

/**
 * Write config to the platform's per-user global config file.
 *
 * Always writes under `repos[repoPath]`. Global top-level fields are not used.
 *
 * @param config - The config fields to write.
 * @param repoPath - The absolute repo path used as the key under `repos`.
 * @param configPath - Override the global config path (used by tests).
 *
 * Reads the existing file first to preserve other repo entries.
 * Creates parent directories as needed. Returns `true` on success, `false` on failure.
 */
export function writeConfig(config: CodepulseConfig, repoPath: string, configPath?: string): boolean {
  const globalPath = configPath ?? defaultConfigPath();

  try {
    // Read existing file to preserve all existing data. Unparseable or non-object
    // content throws: never replace a file we cannot understand.
    let existing: Record<string, unknown> = {};
    if (existsSync(globalPath)) {
      const parsed = JSON.parse(readFileSync(globalPath, "utf-8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("existing file is not a JSON object");
      }
      existing = parsed;
    }

    const merged: Record<string, unknown> = { ...existing };

    // Write config fields under repos[repoPath]
    const absPath = resolve(repoPath);
    let repos = merged.repos as Record<string, unknown> | undefined;
    if (typeof repos !== "object" || repos === null || Array.isArray(repos)) {
      repos = {};
    }
    const repoEntry: Record<string, unknown> = {};
    const existingEntry = repos[absPath];
    if (typeof existingEntry === "object" && existingEntry !== null && !Array.isArray(existingEntry)) {
      Object.assign(repoEntry, existingEntry);
    }
    applyConfigFields(repoEntry, config);
    repos[absPath] = repoEntry;
    merged.repos = repos;

    // Create parent directories if needed
    const dir = dirname(globalPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeJsonAtomic(globalPath, merged);
    return true;
  } catch (err) {
    console.error(`Error: failed to write config to ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Write via temp file + rename so a crash mid-write never leaves a truncated config. */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Remove one saved repo entry from the global config file. */
export function removeRepoConfig(repoPath: string, configPath?: string): boolean {
  const globalPath = configPath ?? defaultConfigPath();

  try {
    if (!existsSync(globalPath)) return true;

    const raw = readFileSync(globalPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;

    const merged = { ...(parsed as Record<string, unknown>) };
    const repos = merged.repos;
    if (typeof repos !== "object" || repos === null || Array.isArray(repos)) return true;

    const nextRepos = { ...(repos as Record<string, unknown>) };
    delete nextRepos[resolve(repoPath)];
    if (Object.keys(nextRepos).length === 0) {
      delete merged.repos;
    } else {
      merged.repos = nextRepos;
    }

    writeJsonAtomic(globalPath, merged);
    return true;
  } catch (err) {
    console.error(`Error: failed to update config at ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Apply defined CodepulseConfig fields to a target object. */
function applyConfigFields(target: Record<string, unknown>, config: CodepulseConfig): void {
  if (config.group !== undefined) target.group = config.group;
  if (config.appName !== undefined) target.appName = config.appName;
  if (config.theme !== undefined) target.theme = config.theme;
  if (config.pageSize !== undefined) target.pageSize = config.pageSize;
  if (config.branch !== undefined) target.branch = config.branch;
  if (config.showAllBranches !== undefined) target.showAllBranches = config.showAllBranches;
  if (config.autoRefreshSeconds !== undefined) target.autoRefreshSeconds = config.autoRefreshSeconds;
  if (config.autoFetchSeconds !== undefined) target.autoFetchSeconds = config.autoFetchSeconds;
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
