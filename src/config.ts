import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_MAX_COUNT } from "./constants";
import { DEFAULT_AUTO_REFRESH_INTERVAL } from "./context/state";

/**
 * Shape of the config file. All fields are optional —
 * missing fields fall through to CLI args or built-in defaults.
 */
export interface CodepulseConfig {
  theme?: string;
  pageSize?: number;
  branch?: string;
  showAllBranches?: boolean;
  /** Auto-refresh interval in seconds. 0 = off. */
  autoRefreshSeconds?: number;
  /** Provider-specific configuration. */
  providers?: {
    github?: {
      /** Whether the GitHub Actions provider is enabled. Defaults to true. */
      enabled?: boolean;
      /** Name of the environment variable holding the GitHub Personal Access Token.
       *  Defaults to "GITHUB_TOKEN". */
      tokenEnvVar?: string;
    };
  };
}

/** Return the built-in default config (all fields populated). */
export function defaultConfig(): Required<Omit<CodepulseConfig, "branch" | "providers">> {
  return {
    theme: "catppuccin-mocha",
    pageSize: DEFAULT_MAX_COUNT,
    showAllBranches: true,
    autoRefreshSeconds: DEFAULT_AUTO_REFRESH_INTERVAL / 1000,
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
  /** Initial pathspec filter from CLI (session-scoped, not persisted). */
  path: string | undefined;
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

/** Default path to the global config file. */
export function defaultConfigPath(): string {
  return join(homedir(), ".config", "codepulse", "config.json");
}

/**
 * Read and parse the raw config JSON from disk.
 * Returns the parsed object and the resolved path, or null if the file
 * doesn't exist or can't be parsed. Warnings are pushed to the provided array.
 */
function readRawConfig(
  configPath: string | undefined,
  warnings: string[],
): { parsed: Record<string, unknown>; globalPath: string } | null {
  const globalPath = configPath ?? defaultConfigPath();
  if (!existsSync(globalPath)) return null;

  try {
    const raw = readFileSync(globalPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      warnings.push(`${globalPath} is not a valid config object, ignoring`);
      return null;
    }
    return { parsed, globalPath };
  } catch (err) {
    warnings.push(`Failed to read ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Resolve the global config file path and check whether it exists
 * and whether the current repo has overrides within it.
 *
 * @param repoPath - The repository directory path.
 * @param configPath - Override the global config path (used by tests).
 */
export function resolveConfigInfo(repoPath: string, configPath?: string): ConfigInfo {
  const globalPath = configPath ?? defaultConfigPath();
  const globalExists = existsSync(globalPath);
  const warnings: string[] = [];

  let hasRepoOverrides = false;
  if (globalExists) {
    const result = readRawConfig(configPath, warnings);
    if (result) {
      const repos = result.parsed.repos;
      if (typeof repos === "object" && repos !== null && !Array.isArray(repos)) {
        const absPath = resolve(repoPath);
        hasRepoOverrides = absPath in (repos as Record<string, unknown>);
      }
    }
  }

  return { globalPath, globalExists, hasRepoOverrides, warnings };
}

/**
 * Return all known repository paths from the global config file.
 *
 * Reads the `repos` map from `~/.config/codepulse/config.json` and returns
 * the keys (absolute paths). Used by the project selector to show previously-
 * opened repos. Returns an empty array if the config file doesn't exist or
 * has no repos.
 */
export function getKnownRepos(configPath?: string): string[] {
  const warnings: string[] = [];
  const result = readRawConfig(configPath, warnings);
  if (!result) return [];

  const repos = result.parsed.repos;
  if (typeof repos !== "object" || repos === null || Array.isArray(repos)) return [];

  return Object.keys(repos as Record<string, unknown>);
}

/**
 * Load config from the global config file.
 *
 * Reads the repo-specific entry from `repos[absoluteRepoPath]` in the config
 * file. Global top-level fields are ignored — each repo gets its own settings,
 * and defaults are hardcoded in the app.
 *
 * @param repoPath - The repository directory (used to look up the repo entry).
 * @param configPath - Override the global config path (used by tests).
 */
export function loadConfig(repoPath: string, configPath?: string): { config: CodepulseConfig; warnings: string[] } {
  const warnings: string[] = [];
  const result = readRawConfig(configPath, warnings);
  if (!result) return { config: {}, warnings };

  const { parsed, globalPath } = result;

  // Only read from repos[repoPath] — no global top-level fields
  const repos = parsed.repos;
  if (typeof repos === "object" && repos !== null && !Array.isArray(repos)) {
    const absPath = resolve(repoPath);
    const repoEntry = (repos as Record<string, unknown>)[absPath];
    if (typeof repoEntry === "object" && repoEntry !== null && !Array.isArray(repoEntry)) {
      return {
        config: validateConfig(repoEntry as Record<string, unknown>, `${globalPath} [repos]`, warnings),
        warnings,
      };
    }
  }

  return { config: {}, warnings };
}

/**
 * Validate and sanitize a raw config object. Unknown keys are silently ignored.
 * Invalid values for known keys produce a warning in the provided array.
 */
function validateConfig(raw: Record<string, unknown>, path: string, warnings: string[]): CodepulseConfig {
  const config: CodepulseConfig = {};

  if (raw.theme !== undefined) {
    if (typeof raw.theme === "string" && raw.theme.length > 0) {
      config.theme = raw.theme;
    } else {
      warnings.push(`${path}: "theme" must be a non-empty string, ignoring`);
    }
  }

  if (raw.pageSize !== undefined) {
    if (typeof raw.pageSize === "number" && Number.isInteger(raw.pageSize) && raw.pageSize >= 1) {
      config.pageSize = raw.pageSize;
    } else {
      warnings.push(`${path}: "pageSize" must be a positive integer, ignoring`);
    }
  }

  if (raw.branch !== undefined) {
    if (typeof raw.branch === "string" && raw.branch.length > 0) {
      config.branch = raw.branch;
    } else {
      warnings.push(`${path}: "branch" must be a non-empty string, ignoring`);
    }
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
          if (typeof gh.tokenEnvVar === "string" && gh.tokenEnvVar.length > 0) {
            config.providers.github.tokenEnvVar = gh.tokenEnvVar;
          } else {
            warnings.push(`${path}: "providers.github.tokenEnvVar" must be a non-empty string, ignoring`);
          }
        }
      }
    } else {
      warnings.push(`${path}: "providers" must be an object, ignoring`);
    }
  }

  return config;
}

/**
 * Merge config file values with CLI options.
 * Priority: CLI (explicit) > config file > built-in defaults.
 */
export function mergeOptions(
  cli: {
    repoPath: string;
    branch?: string;
    all?: boolean;
    maxCount?: number;
    themeName?: string;
    path?: string;
  },
  config: CodepulseConfig,
): AppOptions {
  // Determine branch — CLI wins, then config, then undefined
  const branch = cli.branch ?? config.branch;

  // Determine all — if CLI explicitly set --branch or --no-all, those win.
  // Otherwise use config. Default: true.
  let all: boolean;
  if (cli.all !== undefined) {
    all = cli.all;
  } else if (branch !== undefined) {
    // --branch implies not-all (same as current CLI behavior)
    all = false;
  } else if (config.showAllBranches !== undefined) {
    all = config.showAllBranches;
  } else {
    all = true;
  }

  const defaults = defaultConfig();

  return {
    repoPath: cli.repoPath,
    branch,
    all,
    maxCount: cli.maxCount ?? config.pageSize ?? defaults.pageSize,
    themeName: cli.themeName ?? config.theme ?? defaults.theme,
    autoRefreshInterval:
      config.autoRefreshSeconds !== undefined ? config.autoRefreshSeconds * 1000 : defaults.autoRefreshSeconds * 1000,
    path: cli.path,
  };
}

/**
 * Write config to the global config file at `~/.config/codepulse/config.json`.
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
    // Read existing file to preserve all existing data
    let existing: Record<string, unknown> = {};
    if (existsSync(globalPath)) {
      try {
        const raw = readFileSync(globalPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          existing = parsed;
        }
      } catch {
        // Existing file is corrupt — overwrite entirely
      }
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

    writeFileSync(globalPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
    return true;
  } catch (err) {
    console.error(`Error: failed to write config to ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Apply defined CodepulseConfig fields to a target object. */
function applyConfigFields(target: Record<string, unknown>, config: CodepulseConfig): void {
  if (config.theme !== undefined) target.theme = config.theme;
  if (config.pageSize !== undefined) target.pageSize = config.pageSize;
  if (config.branch !== undefined) target.branch = config.branch;
  if (config.showAllBranches !== undefined) target.showAllBranches = config.showAllBranches;
  if (config.autoRefreshSeconds !== undefined) target.autoRefreshSeconds = config.autoRefreshSeconds;
  if (config.providers !== undefined) {
    // Deep-merge providers into existing target.providers to preserve other provider configs
    const existingProviders =
      typeof target.providers === "object" && target.providers !== null && !Array.isArray(target.providers)
        ? { ...(target.providers as Record<string, unknown>) }
        : {};
    if (config.providers.github !== undefined) {
      const existingGh =
        typeof existingProviders.github === "object" &&
        existingProviders.github !== null &&
        !Array.isArray(existingProviders.github)
          ? { ...(existingProviders.github as Record<string, unknown>) }
          : {};
      if (config.providers.github.enabled !== undefined) existingGh.enabled = config.providers.github.enabled;
      if (config.providers.github.tokenEnvVar !== undefined)
        existingGh.tokenEnvVar = config.providers.github.tokenEnvVar;
      existingProviders.github = existingGh;
    }
    target.providers = existingProviders;
  }
}
