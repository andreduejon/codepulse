/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file, the providers' SQLite cache, and each provider's HTTP client, scanner and token. startupProps builds them and registers them
 * (context/ports.ts) for a component rendered without them.
 */

import { providerCacheStore } from "./adapters/cache/cache-store";
import { type CacheLocation, DEFAULT_PROVIDER_CACHE_ROOT } from "./adapters/cache/sha-sqlite-cache";
import * as dashboardLoad from "./adapters/dashboard/load";
import { gitCli } from "./adapters/git/git-cli";
import { githubAdapters } from "./adapters/github/adapters";
import { jenkinsAdapters } from "./adapters/jenkins/adapters";
import { openShiftAdapters } from "./adapters/openshift/adapters";
import { fileSettings } from "./adapters/settings/settings-file";
import { snykAdapters } from "./adapters/snyk/adapters";
import { terminalSystem } from "./adapters/system/system-port";
import type { AppPorts, ProviderAdapters } from "./core/app-ports";
import type { DashboardReader } from "./core/dashboard/load";
import type { GitPort } from "./core/git/port";

/** Where the caches live: the user's cache folder and the process's registry unless given. */
export interface CacheOptions {
  cacheRoot?: string;
  registry?: CacheLocation["registry"];
}

/** The providers' HTTP clients, caches, scanner and environment tokens. */
export function terminalProviderAdapters({ cacheRoot, registry }: CacheOptions = {}): ProviderAdapters {
  return {
    github: githubAdapters(cacheRoot, registry),
    jenkins: jenkinsAdapters(cacheRoot, registry),
    openshift: openShiftAdapters(cacheRoot, registry),
    snyk: snykAdapters(cacheRoot, registry),
  };
}

/** The Dashboard's reads: Git through the app's Git port, and the provider caches (through the module, for tests' spies). */
export function terminalDashboard(git: GitPort, { cacheRoot, registry }: CacheOptions = {}): DashboardReader {
  return {
    readEvents: (app, options) => dashboardLoad.loadAppEvents(app, { cacheRoot, registry, ...options }, git),
  };
}

/** The terminal app's adapters, every cache on one folder and one registry. */
export function terminalPorts(caches: CacheOptions = {}): AppPorts {
  return portsFrom({}, caches);
}

/** The ports given, the terminal app's for the others. */
export function portsFrom(given: Partial<AppPorts>, caches: CacheOptions = {}): AppPorts {
  const git = given.git ?? gitCli();
  return {
    settings: given.settings ?? fileSettings(),
    git,
    cacheStore:
      given.cacheStore ?? providerCacheStore(caches.cacheRoot ?? DEFAULT_PROVIDER_CACHE_ROOT, caches.registry),
    providers: given.providers ?? terminalProviderAdapters(caches),
    system: given.system ?? terminalSystem(),
    dashboard: given.dashboard ?? terminalDashboard(git, caches),
  };
}
