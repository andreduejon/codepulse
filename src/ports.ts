/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file and the providers' SQLite cache. startupProps builds them, the app takes them as
 * props, and the contexts fall back to them for a component rendered on its own (a test).
 */
import type { CacheStorePort } from "./core/cache-store";
import type { GitPort } from "./core/git/port";
import type { SettingsPort } from "./core/settings/port";
import { gitCli } from "./git/git-cli";
import { providerCacheStore } from "./providers/shared/cache-store";
import { fileSettings } from "./settings-file";

export interface AppPorts {
  settings: SettingsPort;
  git: GitPort;
  cacheStore: CacheStorePort;
}

/** The terminal app's adapters. */
export function terminalPorts(): AppPorts {
  return { settings: fileSettings(), git: gitCli(), cacheStore: providerCacheStore() };
}

/** The ports given, the terminal app's for the others. */
export function portsFrom(given: Partial<AppPorts>): AppPorts {
  return {
    settings: given.settings ?? fileSettings(),
    git: given.git ?? gitCli(),
    cacheStore: given.cacheStore ?? providerCacheStore(),
  };
}
