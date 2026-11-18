/** OpenShift as core knows it: its names and its settings. */

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
import { definedFields, type SettingsReader, type SettingsSection } from "../settings/provider-section";
import { OPENSHIFT_BANNER } from "./banner";
import { openShiftEvents } from "./events";
import type { OpenShiftAdapters } from "./service";
import { DEFAULT_OPENSHIFT_CONFIG } from "./types";
import {
  isValidOpenShiftNamespace,
  isValidOpenShiftServerUrl,
  OPENSHIFT_NAMESPACE_MAX_LENGTH,
  OPENSHIFT_SERVER_URL_MAX_LENGTH,
  OPENSHIFT_TEXT_MAX_LENGTH,
} from "./validation";

export interface OpenShiftSettings extends SettingsSection {
  enabled: boolean;
  serverUrl: string;
  /** Web console, for opening resources in the browser (`o`); empty when not set. */
  consoleUrl: string;
  tokenEnvVar: string;
  namespaces: string[];
  commitShaAnnotation: string;
  cacheLimit: ProviderCacheLimit;
  fetchDepth: ProviderLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
}

const httpsUrl = (reader: SettingsReader, field: string, value: unknown): string | undefined => {
  const url = reader.text(field, value, OPENSHIFT_SERVER_URL_MAX_LENGTH);
  if (url === undefined) return undefined;
  if (isValidOpenShiftServerUrl(url)) return url;
  reader.warn(field, "must be a valid HTTPS URL");
  return undefined;
};

export const openShiftProvider: ProviderDefinition<OpenShiftAdapters, OpenShiftSettings> = {
  id: "openshift",
  key: "openshift",
  displayName: "OpenShift",
  detailLabel: "Resources",
  category: "runtime",
  messages: OPENSHIFT_BANNER,
  storedEvents: async (adapters, app) =>
    openShiftEvents(app, await adapters.cache(DEFAULT_PROVIDER_CACHE_LIMIT).peekAll(app)),
  settings: {
    // The service's defaults (types.ts).
    defaults: DEFAULT_OPENSHIFT_CONFIG,
    read: (raw, reader) =>
      definedFields({
        enabled: reader.boolean("enabled", raw.enabled),
        serverUrl: httpsUrl(reader, "serverUrl", raw.serverUrl),
        consoleUrl: httpsUrl(reader, "consoleUrl", raw.consoleUrl),
        tokenEnvVar: reader.text("tokenEnvVar", raw.tokenEnvVar, OPENSHIFT_TEXT_MAX_LENGTH),
        commitShaAnnotation: reader.text("commitShaAnnotation", raw.commitShaAnnotation, OPENSHIFT_TEXT_MAX_LENGTH),
        cacheLimit: reader.oneOf("cacheLimit", raw.cacheLimit, PROVIDER_CACHE_LIMIT_OPTIONS),
        fetchDepth: reader.oneOf("fetchDepth", raw.fetchDepth, PROVIDER_LIMIT_OPTIONS),
        autoRefreshSeconds: reader.oneOf("autoRefreshSeconds", raw.autoRefreshSeconds, PROVIDER_AUTO_REFRESH_SECONDS),
        namespaces: reader.list("namespaces", raw.namespaces)?.flatMap((namespace, index) => {
          const field = `namespaces[${index}]`;
          const value = reader.text(field, namespace, OPENSHIFT_NAMESPACE_MAX_LENGTH);
          if (value === undefined) return [];
          if (isValidOpenShiftNamespace(value)) return [value];
          reader.warn(field, "must be a DNS-1123 label");
          return [];
        }),
      }),
    // The console's address is optional: a backfill doesn't add it.
    backfill: [
      "enabled",
      "serverUrl",
      "tokenEnvVar",
      "namespaces",
      "commitShaAnnotation",
      "cacheLimit",
      "fetchDepth",
      "autoRefreshSeconds",
    ],
  },
};
