/**
 * The settings in the user's JSON file (src/config.ts reads it, src/config-write.ts writes it) as the app's settings
 * port. The calls go through the modules at call time, so a test's spy on one of their functions sees them.
 */
import * as config from "./config";
import * as configWrite from "./config-write";
import type { SettingsPort } from "./core/settings/port";

export function fileSettings(configPath?: string): SettingsPort {
  // The file's path only when one is given: the calls look as they did when the app made them itself.
  const at: [] | [string] = configPath === undefined ? [] : [configPath];
  return {
    load: repoPath => config.loadConfig(repoPath, ...at),
    info: repoPath => config.resolveConfigInfo(repoPath, ...at),
    display: repoPath => config.getRepoDisplayConfig(repoPath, ...at),
    knownRepos: () => config.getKnownRepoInfos(...at),
    write: (settings, repoPath) => configWrite.writeConfig(settings, repoPath, ...at),
    backfill: repoPath => configWrite.backfillRepoConfig(repoPath, ...at),
    remove: repoPath => configWrite.removeRepoConfig(repoPath, ...at),
  };
}
