/**
 * The providers the app runs with: the one place that lists them. Each joins its definition in core (names, settings),
 * the adapters it runs on and, in the terminal, its module. Everything else reads them from the app's provider set.
 */

import type { CacheLocation } from "./adapters/cache/sha-sqlite-cache";
import { githubAdapters } from "./adapters/github/adapters";
import { jenkinsAdapters } from "./adapters/jenkins/adapters";
import { openShiftAdapters } from "./adapters/openshift/adapters";
import { snykAdapters } from "./adapters/snyk/adapters";
import { createProviderSet, type ProviderDefinition, type ProviderSet, providerEntry } from "./core/provider-set";
import type { SettingsSection } from "./core/settings/provider-section";
import { githubModule } from "./tui/providers/github-actions/module";
import { jenkinsModule } from "./tui/providers/jenkins/module";
import type { AnyProviderModule, ProviderModule } from "./tui/providers/module";
import { openShiftModule } from "./tui/providers/openshift/module";
import { snykModule } from "./tui/providers/snyk/module";

/** Where the caches live: the user's cache folder and the process's registry unless given. */
export interface CacheOptions {
  cacheRoot?: string;
  registry?: CacheLocation["registry"];
}

/** A provider as the app is built with it: its definition, how its adapters are made, and its terminal module. */
export interface ProviderPlugin {
  definition: ProviderDefinition;
  /** Its adapters on these caches, joined with its definition. */
  build: (caches: CacheOptions) => ReturnType<typeof providerEntry>;
  module: AnyProviderModule;
}

/** A provider from its terminal module (which carries its definition) and its adapters' factory, checked to fit. */
export function providerPlugin<Adapters, Settings extends SettingsSection, Instance, DetailSource>(
  module: ProviderModule<Adapters, Settings, Instance, DetailSource>,
  adapters: (caches: CacheOptions) => Adapters,
): ProviderPlugin {
  return {
    definition: module.definition,
    build: caches => providerEntry(module.definition, adapters(caches)),
    module: module as unknown as AnyProviderModule,
  };
}

/** The providers codepulse comes with, in the order their views cycle. */
export const builtInProviders: readonly ProviderPlugin[] = [
  providerPlugin(githubModule, ({ cacheRoot, registry }) => githubAdapters(cacheRoot, registry)),
  providerPlugin(jenkinsModule, ({ cacheRoot, registry }) => jenkinsAdapters(cacheRoot, registry)),
  providerPlugin(openShiftModule, ({ cacheRoot, registry }) => openShiftAdapters(cacheRoot, registry)),
  providerPlugin(snykModule, ({ cacheRoot, registry }) => snykAdapters(cacheRoot, registry)),
];

/** The terminal modules of these providers, in their order. */
export const modulesOf = (plugins: readonly ProviderPlugin[]): readonly AnyProviderModule[] =>
  plugins.map(plugin => plugin.module);

/** The provider set of these providers, their adapters on these caches. */
export function providerSetOf(plugins: readonly ProviderPlugin[], caches: CacheOptions = {}): ProviderSet {
  return createProviderSet(plugins.map(plugin => plugin.build(caches)));
}
