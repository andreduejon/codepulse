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
}

/** Resolved options ready for the app (all fields required). */
export interface AppOptions {
  repoPath: string;
  branch: string | undefined;
  all: boolean;
  maxCount: number;
  themeName: string;
  autoRefreshInterval: number;
}

/** Information about the global config file and repo-specific overrides. */
export interface ConfigInfo {
  /** Absolute path to the global config file. */
  globalPath: string;
  /** Whether the global config file exists on disk. */
  globalExists: boolean;
  /** Whether the current repo has specific overrides in the config. */
  hasRepoOverrides: boolean;
}

/** Default path to the global config file. */
export function defaultConfigPath(): string {
  return join(homedir(), ".config", "codepulse", "config.json");
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

  let hasRepoOverrides = false;
  if (globalExists) {
    try {
      const raw = readFileSync(globalPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const repos = parsed.repos;
        if (typeof repos === "object" && repos !== null && !Array.isArray(repos)) {
          const absPath = resolve(repoPath);
          hasRepoOverrides = absPath in repos;
        }
      }
    } catch {
      // Corrupt file — treat as no overrides
    }
  }

  return { globalPath, globalExists, hasRepoOverrides };
}

/**
 * Load config from the global config file.
 *
 * Reads the config file and merges any repo-specific overrides
 * found under `repos[absoluteRepoPath]`. Returns an empty object if
 * the file doesn't exist or is invalid.
 *
 * @param repoPath - The repository directory (used to resolve repo-specific overrides).
 * @param configPath - Override the global config path (used by tests).
 *
 * Priority: repo overrides > global top-level > (empty).
 */
export function loadConfig(repoPath: string, configPath?: string): CodepulseConfig {
  const globalPath = configPath ?? defaultConfigPath();
  if (!existsSync(globalPath)) return {};

  try {
    const raw = readFileSync(globalPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`Warning: ${globalPath} is not a valid config object, ignoring`);
      return {};
    }

    // Validate global top-level config fields
    const globalConfig = validateConfig(parsed, globalPath);

    // Check for repo-specific overrides
    const repos = parsed.repos;
    if (typeof repos === "object" && repos !== null && !Array.isArray(repos)) {
      const absPath = resolve(repoPath);
      const repoOverrides = repos[absPath];
      if (typeof repoOverrides === "object" && repoOverrides !== null && !Array.isArray(repoOverrides)) {
        const repoConfig = validateConfig(repoOverrides, `${globalPath} [repos]`);
        // Merge: repo overrides win over global
        return { ...globalConfig, ...stripUndefined(repoConfig) };
      }
    }

    return globalConfig;
  } catch (err) {
    console.error(`Warning: failed to read ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return {};
  }
}

/** Remove keys whose value is undefined so spreading doesn't clobber defined values. */
function stripUndefined(obj: CodepulseConfig): CodepulseConfig {
  const result: CodepulseConfig = {};
  if (obj.theme !== undefined) result.theme = obj.theme;
  if (obj.pageSize !== undefined) result.pageSize = obj.pageSize;
  if (obj.branch !== undefined) result.branch = obj.branch;
  if (obj.showAllBranches !== undefined) result.showAllBranches = obj.showAllBranches;
  if (obj.autoRefreshSeconds !== undefined) result.autoRefreshSeconds = obj.autoRefreshSeconds;
  return result;
}

/**
 * Validate and sanitize a raw config object. Unknown keys are silently ignored.
 * Invalid values for known keys produce a warning and are dropped.
 */
function validateConfig(raw: Record<string, unknown>, path: string): CodepulseConfig {
  const config: CodepulseConfig = {};

  if (raw.theme !== undefined) {
    if (typeof raw.theme === "string" && raw.theme.length > 0) {
      config.theme = raw.theme;
    } else {
      console.error(`Warning: ${path}: "theme" must be a non-empty string, ignoring`);
    }
  }

  if (raw.pageSize !== undefined) {
    if (typeof raw.pageSize === "number" && Number.isInteger(raw.pageSize) && raw.pageSize >= 1) {
      config.pageSize = raw.pageSize;
    } else {
      console.error(`Warning: ${path}: "pageSize" must be a positive integer, ignoring`);
    }
  }

  if (raw.branch !== undefined) {
    if (typeof raw.branch === "string" && raw.branch.length > 0) {
      config.branch = raw.branch;
    } else {
      console.error(`Warning: ${path}: "branch" must be a non-empty string, ignoring`);
    }
  }

  if (raw.showAllBranches !== undefined) {
    if (typeof raw.showAllBranches === "boolean") {
      config.showAllBranches = raw.showAllBranches;
    } else {
      console.error(`Warning: ${path}: "showAllBranches" must be a boolean, ignoring`);
    }
  }

  if (raw.autoRefreshSeconds !== undefined) {
    if (typeof raw.autoRefreshSeconds === "number" && raw.autoRefreshSeconds >= 0) {
      config.autoRefreshSeconds = raw.autoRefreshSeconds;
    } else {
      console.error(`Warning: ${path}: "autoRefreshSeconds" must be a non-negative number, ignoring`);
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

  return {
    repoPath: cli.repoPath,
    branch,
    all,
    maxCount: cli.maxCount ?? config.pageSize ?? DEFAULT_MAX_COUNT,
    themeName: cli.themeName ?? config.theme ?? "catppuccin-mocha",
    autoRefreshInterval:
      config.autoRefreshSeconds !== undefined ? config.autoRefreshSeconds * 1000 : DEFAULT_AUTO_REFRESH_INTERVAL,
  };
}

/**
 * Write config to the global config file at `~/.config/codepulse/config.json`.
 *
 * @param config - The config fields to write.
 * @param scope - `"global"` writes to top-level keys; `"repo"` writes under `repos[repoPath]`.
 * @param repoPath - Required when scope is `"repo"`. The absolute repo path used as the key.
 * @param configPath - Override the global config path (used by tests).
 *
 * Reads the existing file first to preserve unknown keys and other repo entries.
 * Creates parent directories as needed. Returns `true` on success, `false` on failure.
 */
export function writeConfig(
  config: CodepulseConfig,
  scope: "global" | "repo",
  repoPath?: string,
  configPath?: string,
): boolean {
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

    if (scope === "global") {
      // Write config fields at the top level
      applyConfigFields(merged, config);
    } else {
      // Write config fields under repos[repoPath]
      if (!repoPath) {
        console.error("Error: writeConfig with scope='repo' requires repoPath");
        return false;
      }
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
    }

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
}
