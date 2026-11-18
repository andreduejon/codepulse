/** GitHub Actions as core knows it: its names and its settings. */
import { githubEvents } from "../dashboard/events";
import type { ProviderDefinition } from "../provider-set";
import {
  DEFAULT_PROVIDER_CACHE_LIMIT,
  PROVIDER_AUTO_REFRESH_SECONDS,
  PROVIDER_CACHE_LIMIT_OPTIONS,
  PROVIDER_LIMIT_OPTIONS,
  type ProviderAutoRefreshSeconds,
  type ProviderCacheLimit,
  type ProviderLimit,
} from "../provider-settings";
import { definedFields, type SettingsSection } from "../settings/provider-section";
import { normalizeGitHubHost } from "./host";
import type { GitHubAdapters } from "./service";

const TEXT_MAX_LENGTH = 255;

export interface GitHubSettings extends SettingsSection {
  enabled: boolean;
  /** The environment variable holding the token: GITHUB_TOKEN by default. */
  tokenEnvVar: string;
  /** A GitHub Enterprise host this repository trusts; github.com always is. */
  trustedEnterpriseHost?: string;
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
}

export const githubProvider: ProviderDefinition<GitHubAdapters, GitHubSettings> = {
  id: "github-actions",
  key: "github",
  displayName: "GitHub",
  detailLabel: "Actions",
  category: "ci",
  storedEvents: async (adapters, app) =>
    githubEvents(app, await adapters.cache(DEFAULT_PROVIDER_CACHE_LIMIT).peekAll(app)),
  settings: {
    defaults: {
      enabled: false,
      tokenEnvVar: "GITHUB_TOKEN",
      trustedEnterpriseHost: undefined,
      fetchDepth: 20,
      cacheLimit: 20,
      autoRefreshSeconds: 120,
    },
    read: (raw, reader) => {
      const trustedEnterpriseHost = (() => {
        const value = raw.trustedEnterpriseHost;
        if (value === undefined) return undefined;
        if (typeof value !== "string") {
          reader.warn("trustedEnterpriseHost", "must be a host string");
          return undefined;
        }
        const host = normalizeGitHubHost(value);
        if (!host || host === "github.com") {
          reader.warn("trustedEnterpriseHost", "must be a valid non-github.com host");
          return undefined;
        }
        return host;
      })();
      return definedFields({
        enabled: reader.boolean("enabled", raw.enabled),
        tokenEnvVar: reader.text("tokenEnvVar", raw.tokenEnvVar, TEXT_MAX_LENGTH),
        trustedEnterpriseHost,
        cacheLimit: reader.oneOf("cacheLimit", raw.cacheLimit, PROVIDER_CACHE_LIMIT_OPTIONS),
        fetchDepth: reader.oneOf("fetchDepth", raw.fetchDepth, PROVIDER_LIMIT_OPTIONS),
        autoRefreshSeconds: reader.oneOf("autoRefreshSeconds", raw.autoRefreshSeconds, PROVIDER_AUTO_REFRESH_SECONDS),
      });
    },
  },
};
