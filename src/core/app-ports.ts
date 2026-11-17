/** Every port the app runs on: what a front end hands the app, built by its composition root. */

import type { CacheStorePort } from "./cache-store";
import type { DashboardReader } from "./dashboard/load";
import type { GitPort } from "./git/port";
import type { GitHubAdapters } from "./github/service";
import type { JenkinsAdapters } from "./jenkins/service";
import type { OpenShiftAdapters } from "./openshift/service";
import type { SettingsPort } from "./settings/port";
import type { SnykAdapters } from "./snyk/service";
import type { SystemPort } from "./system";

/** What every provider gets from outside, by provider. */
export interface ProviderAdapters {
  github: GitHubAdapters;
  jenkins: JenkinsAdapters;
  openshift: OpenShiftAdapters;
  snyk: SnykAdapters;
}

export interface AppPorts {
  settings: SettingsPort;
  git: GitPort;
  cacheStore: CacheStorePort;
  providers: ProviderAdapters;
  system: SystemPort;
  dashboard: DashboardReader;
}
