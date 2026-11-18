/** Jenkins as core knows it: its names and its settings. */

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
import { JENKINS_BANNER } from "./banner";
import { jenkinsEvents } from "./events";
import type { JenkinsAdapters } from "./service";
import { DEFAULT_JENKINS_CONFIG, type JenkinsJobConfig } from "./types";
import { isValidJenkinsJobUrl, JENKINS_JOB_URL_MAX_LENGTH } from "./validation";

const TEXT_MAX_LENGTH = 255;

export interface JenkinsSettings extends SettingsSection {
  enabled: boolean;
  username?: string;
  tokenEnvVar: string;
  /** @deprecated Prefer fetchDepth. Still read as its fallback. */
  graphBuildLimit?: ProviderLimit;
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
  jobs: JenkinsJobConfig[];
}

export const jenkinsProvider: ProviderDefinition<JenkinsAdapters, JenkinsSettings> = {
  id: "jenkins",
  key: "jenkins",
  displayName: "Jenkins",
  detailLabel: "Builds",
  category: "ci",
  messages: JENKINS_BANNER,
  storedEvents: async (adapters, app) =>
    jenkinsEvents(app, await adapters.cache(DEFAULT_PROVIDER_CACHE_LIMIT).peekAll(app)),
  settings: {
    // The service's defaults (types.ts); graphBuildLimit is read only as fetchDepth's fallback, never written.
    defaults: { ...DEFAULT_JENKINS_CONFIG, username: undefined, graphBuildLimit: undefined },
    read: (raw, reader) => {
      const enabled = reader.boolean("enabled", raw.enabled);
      const username = reader.text("username", raw.username, TEXT_MAX_LENGTH);
      const tokenEnvVar = reader.text("tokenEnvVar", raw.tokenEnvVar, TEXT_MAX_LENGTH);
      const graphBuildLimit = reader.oneOf("graphBuildLimit", raw.graphBuildLimit, PROVIDER_LIMIT_OPTIONS);
      const cacheLimit = reader.oneOf("cacheLimit", raw.cacheLimit, PROVIDER_CACHE_LIMIT_OPTIONS);
      const fetchDepth = reader.oneOf("fetchDepth", raw.fetchDepth, PROVIDER_LIMIT_OPTIONS) ?? graphBuildLimit;
      const autoRefreshSeconds = reader.oneOf(
        "autoRefreshSeconds",
        raw.autoRefreshSeconds,
        PROVIDER_AUTO_REFRESH_SECONDS,
      );
      const jobs = reader.list("jobs", raw.jobs)?.flatMap((job, index) => {
        if (typeof job !== "object" || job === null || Array.isArray(job)) {
          reader.warn(`jobs[${index}]`, "must be an object");
          return [];
        }
        const rawJob = job as Record<string, unknown>;
        const url = reader.text(`jobs[${index}].url`, rawJob.url, JENKINS_JOB_URL_MAX_LENGTH);
        if (url === undefined) return [];
        if (!isValidJenkinsJobUrl(url)) {
          reader.warn(`jobs[${index}].url`, "must be a valid HTTPS URL");
          return [];
        }
        const label = reader.text(`jobs[${index}].label`, rawJob.label, TEXT_MAX_LENGTH);
        return [{ url, ...(label === undefined ? {} : { label }) }];
      });
      return definedFields({
        enabled,
        username,
        tokenEnvVar,
        graphBuildLimit,
        cacheLimit,
        fetchDepth,
        autoRefreshSeconds,
        jobs,
      });
    },
    // A section with only the older graphBuildLimit keeps it as its fetch depth.
    missing: (existing, defaults) => {
      const fetchDepth = existing.fetchDepth ?? existing.graphBuildLimit;
      if (
        existing.enabled !== undefined &&
        existing.tokenEnvVar !== undefined &&
        fetchDepth !== undefined &&
        existing.cacheLimit !== undefined &&
        existing.autoRefreshSeconds !== undefined &&
        existing.jobs !== undefined
      )
        return null;
      return {
        ...(existing.enabled === undefined ? { enabled: defaults.enabled } : {}),
        ...(existing.tokenEnvVar === undefined ? { tokenEnvVar: defaults.tokenEnvVar } : {}),
        ...(existing.fetchDepth === undefined ? { fetchDepth: fetchDepth ?? defaults.fetchDepth } : {}),
        ...(existing.cacheLimit === undefined ? { cacheLimit: defaults.cacheLimit } : {}),
        ...(existing.autoRefreshSeconds === undefined ? { autoRefreshSeconds: defaults.autoRefreshSeconds } : {}),
        ...(existing.jobs === undefined ? { jobs: defaults.jobs } : {}),
      };
    },
  },
};
