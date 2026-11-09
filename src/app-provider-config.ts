import type { CodepulseConfig } from "./config";
import type {
  GitHubMenuConfig,
  JenkinsMenuConfig,
  OpenShiftMenuConfig,
  SnykMenuConfig,
} from "./hooks/menu-items-types";

type ProviderSettings = NonNullable<CodepulseConfig["providers"]>;

/** Provider settings with defaults filled in, from startup props or a reloaded config file. */
export function githubSettings(raw: ProviderSettings["github"] = {}): GitHubMenuConfig {
  return {
    enabled: raw.enabled ?? false,
    tokenEnvVar: raw.tokenEnvVar ?? "GITHUB_TOKEN",
    trustedEnterpriseHost: raw.trustedEnterpriseHost ?? null,
    fetchDepth: raw.fetchDepth ?? 20,
    cacheLimit: raw.cacheLimit ?? 20,
    autoRefreshSeconds: raw.autoRefreshSeconds ?? 120,
  };
}

export function jenkinsSettings(raw: ProviderSettings["jenkins"] = {}): JenkinsMenuConfig {
  return {
    enabled: raw.enabled ?? false,
    username: raw.username,
    tokenEnvVar: raw.tokenEnvVar ?? "JENKINS_TOKEN",
    fetchDepth: raw.fetchDepth ?? raw.graphBuildLimit ?? 20,
    cacheLimit: raw.cacheLimit ?? 20,
    autoRefreshSeconds: raw.autoRefreshSeconds ?? 120,
    jobs: raw.jobs ?? [],
  };
}

export function openShiftSettings(raw: ProviderSettings["openshift"] = {}): OpenShiftMenuConfig {
  return {
    enabled: raw.enabled ?? false,
    serverUrl: raw.serverUrl ?? "",
    consoleUrl: raw.consoleUrl ?? "",
    tokenEnvVar: raw.tokenEnvVar ?? "OPENSHIFT_TOKEN",
    namespaces: raw.namespaces ?? [],
    commitShaAnnotation: raw.commitShaAnnotation ?? "dev/commit-sha",
    cacheLimit: raw.cacheLimit ?? 20,
    fetchDepth: raw.fetchDepth ?? 20,
    autoRefreshSeconds: raw.autoRefreshSeconds ?? 120,
  };
}

export function snykSettings(raw: ProviderSettings["snyk"] = {}): SnykMenuConfig {
  return {
    enabled: raw.enabled ?? false,
    tokenEnvVar: raw.tokenEnvVar ?? "SNYK_TOKEN",
    autoScanBranches: raw.autoScanBranches ?? [],
    maxCachedScans: raw.maxCachedScans ?? 20,
  };
}
