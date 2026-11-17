import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type CodepulseConfig,
  missingDefaults,
  withoutRepoSettings,
  withRepoSettings,
} from "../../core/settings/config";
import { defaultConfigPath, loadConfig } from "./config";

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
  const missing = missingDefaults(existing);
  if (missing) writeConfig(missing, repoPath, configPath);
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

    const merged = withRepoSettings(existing, resolve(repoPath), config);

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

    const merged = withoutRepoSettings(parsed as Record<string, unknown>, resolve(repoPath));
    if (merged === parsed) return true;
    writeJsonAtomic(globalPath, merged);
    return true;
  } catch (err) {
    console.error(`Error: failed to update config at ${globalPath}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
