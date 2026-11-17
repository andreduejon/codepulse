/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file, the providers' SQLite cache, and each provider's HTTP client, scanner and token. startupProps builds them, the app takes them as
 * props, and the contexts fall back to them for a component rendered on its own (a test).
 */

import type { CacheStorePort } from "./core/cache-store";
import type { GitPort } from "./core/git/port";
import type { SettingsPort } from "./core/settings/port";
import { gitCli } from "./git/git-cli";
import { githubAdapters } from "./providers/github-actions/adapters";
import { jenkinsAdapters } from "./providers/jenkins/adapters";
import type { ProviderAdapters } from "./providers/module";
import { openShiftAdapters } from "./providers/openshift/adapters";
import { providerCacheStore } from "./providers/shared/cache-store";
import { snykAdapters } from "./providers/snyk/adapters";
import { fileSettings } from "./settings-file";

export interface AppPorts {
  settings: SettingsPort;
  git: GitPort;
  cacheStore: CacheStorePort;
  /** Each provider's API, cache and token. */
  providers: ProviderAdapters;
}

/** The providers' HTTP clients, caches, scanner and environment tokens. */
export function terminalProviderAdapters(): ProviderAdapters {
  return { github: githubAdapters(), jenkins: jenkinsAdapters(), openshift: openShiftAdapters(), snyk: snykAdapters() };
}

/** The terminal app's adapters. */
export function terminalPorts(): AppPorts {
  return {
    settings: fileSettings(),
    git: gitCli(),
    cacheStore: providerCacheStore(),
    providers: terminalProviderAdapters(),
  };
}

/** The ports given, the terminal app's for the others. */
export function portsFrom(given: Partial<AppPorts>): AppPorts {
  return {
    settings: given.settings ?? fileSettings(),
    git: given.git ?? gitCli(),
    cacheStore: given.cacheStore ?? providerCacheStore(),
    providers: given.providers ?? terminalProviderAdapters(),
  };
}
