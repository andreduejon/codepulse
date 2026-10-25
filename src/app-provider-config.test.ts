import { expect, test } from "bun:test";
import { githubSettings, jenkinsSettings, openShiftSettings, snykSettings } from "./app-provider-config";

test("missing provider settings get their defaults", () => {
  expect(githubSettings()).toEqual({
    enabled: false,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: null,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
  });
  expect(openShiftSettings({ namespaces: ["dev"] })).toMatchObject({
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: ["dev"],
    commitShaAnnotation: "dev/commit-sha",
  });
  expect(snykSettings({ enabled: true })).toEqual({
    enabled: true,
    tokenEnvVar: "SNYK_TOKEN",
    autoScanBranches: [],
    maxCachedScans: 20,
  });
});

test("Jenkins falls back to the deprecated graphBuildLimit for its fetch size", () => {
  expect(jenkinsSettings({ graphBuildLimit: 50 }).fetchDepth).toBe(50);
  expect(jenkinsSettings({ graphBuildLimit: 50, fetchDepth: 10 }).fetchDepth).toBe(10);
  expect(jenkinsSettings().jobs).toEqual([]);
});
