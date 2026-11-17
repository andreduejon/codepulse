/**
 * The composition root's one place for the adapters: the ports the terminal app runs on, built from the Git command
 * line, the user's settings file, the providers' SQLite cache, and each provider's HTTP client, scanner and token. startupProps builds them and registers them
 * (context/ports.ts) for a component rendered without them.
 */

import type { AppPorts, ProviderAdapters } from "./core/app-ports";
import { gitCli } from "./git/git-cli";
import { githubAdapters } from "./providers/github-actions/adapters";
import { jenkinsAdapters } from "./providers/jenkins/adapters";
import { openShiftAdapters } from "./providers/openshift/adapters";
import { providerCacheStore } from "./providers/shared/cache-store";
import { snykAdapters } from "./providers/snyk/adapters";
import { fileSettings } from "./settings-file";

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
