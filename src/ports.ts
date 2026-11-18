/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file, the providers' SQLite cache, and each provider's HTTP client, scanner and token. startupProps builds them and registers them
 * (context/ports.ts) for a component rendered without them.
 */

import { providerCacheStore } from "./adapters/cache/cache-store";
import { DEFAULT_PROVIDER_CACHE_ROOT } from "./adapters/cache/sha-sqlite-cache";
import * as dashboardLoad from "./adapters/dashboard/load";
import { gitCli } from "./adapters/git/git-cli";
import { fileSettings } from "./adapters/settings/settings-file";
import { terminalSystem } from "./adapters/system/system-port";
import type { AppPorts } from "./core/app-ports";
import type { DashboardReader } from "./core/dashboard/load";
import type { GitPort } from "./core/git/port";
import type { ProviderSet } from "./core/provider-set";
import { builtInProviders, type CacheOptions, type ProviderPlugin, providerSetOf } from "./providers";

export type { CacheOptions } from "./providers";

/** The Dashboard's reads: Git through the app's Git port, and each provider's stored events (through the module, for
 * tests' spies). */
export function terminalDashboard(git: GitPort, providers: ProviderSet): DashboardReader {
  return {
    readEvents: (app, options) => dashboardLoad.loadAppEvents(app, options, providers, git),
  };
}

/** The terminal app's adapters, every cache on one folder and one registry; the built-in providers unless given. */
export function terminalPorts(
  caches: CacheOptions = {},
  plugins: readonly ProviderPlugin[] = builtInProviders,
): AppPorts {
  return portsFrom({}, caches, plugins);
}

/** The ports given, the terminal app's for the others. */
export function portsFrom(
  given: Partial<AppPorts>,
  caches: CacheOptions = {},
  plugins: readonly ProviderPlugin[] = builtInProviders,
): AppPorts {
  const git = given.git ?? gitCli();
  const providers = given.providers ?? providerSetOf(plugins, caches);
  return {
    settings: given.settings ?? fileSettings(providers.definitions),
    git,
    cacheStore:
      given.cacheStore ?? providerCacheStore(caches.cacheRoot ?? DEFAULT_PROVIDER_CACHE_ROOT, caches.registry),
    providers,
    system: given.system ?? terminalSystem(),
    dashboard: given.dashboard ?? terminalDashboard(git, providers),
  };
}
