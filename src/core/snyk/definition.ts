/** Snyk as core knows it: its names, its second detail tab and its settings. */

import type { ProviderDefinition } from "../provider-set";
import { PROVIDER_CACHE_LIMIT_OPTIONS } from "../provider-settings";
import { definedFields } from "../settings/provider-section";
import { snykEvents } from "./events";
import type { SnykAdapters, SnykSettings } from "./service";

const TEXT_MAX_LENGTH = 255;

export const snykProvider: ProviderDefinition<SnykAdapters, SnykSettings> = {
  id: "snyk",
  key: "snyk",
  displayName: "Snyk",
  detailLabel: "Vulnerabilities",
  category: "scan-quality",
  moreTabs: [{ id: "snyk-deps", label: "Dependencies" }],
  storedEvents: async (adapters, app) => snykEvents(app, await adapters.storedScans(app)),
  settings: {
    defaults: { enabled: false, tokenEnvVar: "SNYK_TOKEN", autoScanBranches: [], maxCachedScans: 20 },
    // In the section's order, so several wrong values warn in that order.
    read: (raw, reader) => {
      const enabled = reader.boolean("enabled", raw.enabled);
      const tokenEnvVar = reader.text("tokenEnvVar", raw.tokenEnvVar, TEXT_MAX_LENGTH);
      const branches = reader.list("autoScanBranches", raw.autoScanBranches);
      return definedFields({
        enabled,
        tokenEnvVar,
        autoScanBranches: branches && [
          ...new Set(
            branches.flatMap((branch, index) => {
              const value = reader.text(`autoScanBranches[${index}]`, branch, TEXT_MAX_LENGTH);
              return value === undefined ? [] : [value];
            }),
          ),
        ],
        maxCachedScans: reader.oneOf("maxCachedScans", raw.maxCachedScans, PROVIDER_CACHE_LIMIT_OPTIONS),
      });
    },
  },
};
