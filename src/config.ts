import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CodepulseConfig,
  type ConfigInfo,
  hasRepoSettings,
  type KnownRepoInfo,
  knownReposIn,
  repoSettingsIn,
} from "./core/settings/config";
import { storageRoot } from "./utils/storage-path";

/** Default path to the global config file. */
export function defaultConfigPath(): string {
  return join(storageRoot("config"), "config.json");
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

  const document = globalExists ? readRawConfig(configPath, warnings)?.parsed : undefined;
  const hasRepoOverrides = !!document && hasRepoSettings(document, resolve(repoPath));

  return { globalPath, globalExists, hasRepoOverrides, warnings };
}

export function getRepoDisplayConfig(
  repoPath: string,
  configPath?: string,
): Pick<CodepulseConfig, "group" | "appName"> {
  const { config } = loadConfig(repoPath, configPath);
  return { group: config.group, appName: config.appName };
}

/** Return all known repositories with optional display metadata from config. */
export function getKnownRepoInfos(configPath?: string): KnownRepoInfo[] {
  const warnings: string[] = [];
  const result = readRawConfig(configPath, warnings);
  if (!result) return [];

  return knownReposIn(result.parsed, result.globalPath, warnings);
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

  return { config: repoSettingsIn(result.parsed, resolve(repoPath), result.globalPath, warnings), warnings };
}
