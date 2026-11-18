import { expect, test } from "bun:test";
import { githubProvider } from "../../core/github/definition";
import { jenkinsProvider } from "../../core/jenkins/definition";
import { openShiftProvider } from "../../core/openshift/definition";
import { validateConfig } from "../../core/settings/config";
import { snykProvider } from "../../core/snyk/definition";
import { resolvedSettings } from "./repo-settings";

const PROVIDERS = [githubProvider, jenkinsProvider, openShiftProvider, snykProvider];
const read = (providers: Record<string, unknown>) => validateConfig({ providers }, "test", [], PROVIDERS);

test("missing provider settings get their defaults", () => {
  expect(resolvedSettings(githubProvider, {})).toEqual({
    enabled: false,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: undefined,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
  });
  expect(resolvedSettings(openShiftProvider, read({ openshift: { namespaces: ["dev"] } }))).toMatchObject({
    consoleUrl: "",
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: ["dev"],
    commitShaAnnotation: "dev/commit-sha",
  });
  expect(resolvedSettings(snykProvider, read({ snyk: { enabled: true } }))).toEqual({
    enabled: true,
    tokenEnvVar: "SNYK_TOKEN",
    autoScanBranches: [],
    maxCachedScans: 20,
  });
});

test("Jenkins falls back to the deprecated graphBuildLimit for its fetch size", () => {
  expect(resolvedSettings(jenkinsProvider, read({ jenkins: { graphBuildLimit: 50 } })).fetchDepth).toBe(50);
  expect(resolvedSettings(jenkinsProvider, read({ jenkins: { graphBuildLimit: 50, fetchDepth: 10 } })).fetchDepth).toBe(
    10,
  );
  expect(resolvedSettings(jenkinsProvider, {}).jobs).toEqual([]);
});
