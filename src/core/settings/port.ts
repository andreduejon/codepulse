import type { CodepulseConfig, ConfigInfo, KnownRepoInfo } from "./config";

/**
 * Where the settings live and how the app reads and changes them. The terminal app keeps them in one JSON file per
 * user (src/config.ts); a test or another front end can keep them anywhere else.
 */
export interface SettingsPort {
  /** A repository's settings, checked; `warnings` names what was wrong and left out. */
  load: (repoPath: string) => { config: CodepulseConfig; warnings: string[] };
  /** Where the settings are, whether they exist, and whether this repository has its own. */
  info: (repoPath: string) => ConfigInfo;
  /** A repository's group and app name, for titles and the project list. */
  display: (repoPath: string) => Pick<CodepulseConfig, "group" | "appName">;
  /** Every repository with settings. */
  knownRepos: () => KnownRepoInfo[];
  /** Sets these fields of a repository's settings, keeping the others; false when the settings couldn't be written. */
  write: (config: CodepulseConfig, repoPath: string) => boolean;
  /** Writes the defaults a repository's settings lack, so the file shows every setting. */
  backfill: (repoPath: string) => void;
  /** Forgets a repository's settings; false when the settings couldn't be written. */
  remove: (repoPath: string) => boolean;
}
