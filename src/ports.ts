/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file, the providers' SQLite cache, and each provider's HTTP client, scanner and token. startupProps builds them and registers them
 * (context/ports.ts) for a component rendered without them.
 */

import { providerCacheStore } from "./adapters/cache/cache-store";
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

/** The providers' HTTP clients, caches, scanner and environment tokens. */
export function terminalProviderAdapters(): ProviderAdapters {
  return { github: githubAdapters(), jenkins: jenkinsAdapters(), openshift: openShiftAdapters(), snyk: snykAdapters() };
}

/** The terminal app's adapters. */
/** The Dashboard's reads: Git through the app's Git port, and the provider caches (through the module, for tests' spies). */
export function terminalDashboard(git: GitPort): DashboardReader {
  return { readEvents: (app, options) => dashboardLoad.loadAppEvents(app, options, git) };
}

export function terminalPorts(): AppPorts {
  return portsFrom({});
}

/** The ports given, the terminal app's for the others. */
export function portsFrom(given: Partial<AppPorts>): AppPorts {
  const git = given.git ?? gitCli();
  return {
    settings: given.settings ?? fileSettings(),
    git,
    cacheStore: given.cacheStore ?? providerCacheStore(),
    providers: given.providers ?? terminalProviderAdapters(),
    system: given.system ?? terminalSystem(),
    dashboard: given.dashboard ?? terminalDashboard(git),
  };
}
