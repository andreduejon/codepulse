/** Every port the app runs on: what a front end hands the app, built by its composition root. */

import type { CacheStorePort } from "./cache-store";
import type { DashboardReader } from "./dashboard/load";
import type { GitPort } from "./git/port";
import type { ProviderSet } from "./provider-set";
import type { SettingsPort } from "./settings/port";
import type { SystemPort } from "./system";

export interface AppPorts {
  settings: SettingsPort;
  git: GitPort;
  cacheStore: CacheStorePort;
  /** The providers: their definitions, and the adapters each runs on. */
  providers: ProviderSet;
  system: SystemPort;
  dashboard: DashboardReader;
}
