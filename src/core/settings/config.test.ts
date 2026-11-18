/** The settings document without a file: reading a repository's settings, changing and removing them, the defaults. */
import { expect, test } from "bun:test";
import { githubProvider } from "../github/definition";
import { jenkinsProvider } from "../jenkins/definition";
import { openShiftProvider } from "../openshift/definition";
import { snykProvider } from "../snyk/definition";
import {
  defaultConfig,
  hasRepoSettings,
  knownReposIn,
  missingDefaults,
  repoSettingsIn,
  validateConfig,
  withoutRepoSettings,
  withRepoSettings,
} from "./config";
import { settingsChanges } from "./provider-section";

const PROVIDERS = [githubProvider, jenkinsProvider, openShiftProvider, snykProvider];

const document = {
  other: "kept",
  repos: {
    "/repo/a": { group: "shop", appName: "web", pageSize: 50, unknown: true },
    "/repo/b": { pageSize: "many" },
  },
};

test("a repository's settings are checked: what is wrong is left out and named", () => {
  const warnings: string[] = [];
  expect(repoSettingsIn(document, "/repo/a", "file", warnings, PROVIDERS)).toEqual({
    group: "shop",
    appName: "web",
    pageSize: 50,
  });
  expect(warnings).toEqual([]);
  expect(repoSettingsIn(document, "/repo/b", "file", warnings, PROVIDERS)).toEqual({});
  expect(warnings).toHaveLength(1);
  expect(repoSettingsIn(document, "/repo/none", "file", warnings, PROVIDERS)).toEqual({});
  expect(hasRepoSettings(document, "/repo/a")).toBe(true);
  expect(hasRepoSettings(document, "/repo/none")).toBe(false);
});

test("the known repositories carry their group and app name", () => {
  expect(knownReposIn(document, "file", [])).toEqual([
    { path: "/repo/a", group: "shop", appName: "web" },
    { path: "/repo/b" },
  ]);
});

test("writing a repository's settings keeps its other fields and everything else in the document", () => {
  const next = withRepoSettings(document, "/repo/a", { pageSize: 100 });
  expect(next.other).toBe("kept");
  expect((next.repos as Record<string, unknown>)["/repo/a"]).toEqual({
    group: "shop",
    appName: "web",
    pageSize: 100,
    unknown: true,
  });
  expect(document.repos["/repo/a"].pageSize).toBe(50);
  expect(withRepoSettings({}, "/repo/new", { theme: "nord" })).toEqual({ repos: { "/repo/new": { theme: "nord" } } });
});

test("removing the last repository removes `repos`", () => {
  const once = withoutRepoSettings(document, "/repo/a");
  expect(Object.keys(once.repos as object)).toEqual(["/repo/b"]);
  expect(withoutRepoSettings(once, "/repo/b")).toEqual({ other: "kept" });
});

test("the missing defaults never name a setting the repository has", () => {
  const missing = missingDefaults({ pageSize: 50, providers: { snyk: { enabled: true } } }, PROVIDERS);
  expect(missing?.pageSize).toBeUndefined();
  expect(missing?.theme).toBe(defaultConfig().theme);
  expect(missing?.providers?.snyk?.enabled).toBeUndefined();
  expect(missing?.providers?.snyk?.tokenEnvVar).toBe(defaultConfig(PROVIDERS).providers.snyk?.tokenEnvVar);
});

test("a provider's changed settings: what changed, and a field emptied as cleared (null), nothing else", () => {
  const before: { enabled: boolean; tokenEnvVar: string; trustedEnterpriseHost?: string } = {
    enabled: true,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: "ghe.example.com",
  };
  expect(settingsChanges(before, { ...before, trustedEnterpriseHost: undefined })).toEqual({
    trustedEnterpriseHost: null,
  });
  expect(settingsChanges(before, { ...before, enabled: false })).toEqual({ enabled: false });
  expect(settingsChanges(before, before)).toEqual({});
  // Arrays and objects compare by content: the same jobs again is no change.
  const jobs = { jobs: [{ url: "https://ci.example.com/job/a" }] };
  expect(settingsChanges(jobs, { jobs: [{ url: "https://ci.example.com/job/a" }] })).toEqual({});
});

test("several wrong values warn in the order the section lists them, as before", () => {
  const warnings: string[] = [];
  validateConfig(
    {
      providers: {
        github: { enabled: 1, tokenEnvVar: 1, trustedEnterpriseHost: 1 },
        snyk: { enabled: 1, tokenEnvVar: 1, autoScanBranches: 1 },
      },
    },
    "file",
    warnings,
    PROVIDERS,
  );
  expect(warnings.map(warning => /"providers\.(\w+\.\w+)"/.exec(warning)?.[1])).toEqual([
    "github.enabled",
    "github.tokenEnvVar",
    "github.trustedEnterpriseHost",
    "snyk.enabled",
    "snyk.tokenEnvVar",
    "snyk.autoScanBranches",
  ]);
});
