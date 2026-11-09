import { describe, expect, test } from "bun:test";
import {
  buildGitHubProviderItems,
  buildJenkinsProviderItems,
  buildOpenShiftProviderItems,
  buildSnykProviderItems,
} from "../src/hooks/menu-provider-items";
import { KEYBINDS } from "../src/keybinds";

function sectionKeys(label: string): string[] {
  const rows = KEYBINDS.general;
  const start = rows.findIndex(row => row.kind === "section" && row.label === label);
  if (start < 0) throw new Error(`Missing help section ${label}`);
  const end = rows.findIndex((row, index) => index > start && row.kind === "section");
  return rows.slice(start + 1, end < 0 ? undefined : end).flatMap(row => (row.kind === "binding" ? [row.key] : []));
}

describe("help reference", () => {
  test("the Logs section lists every key the CI and OpenShift log footers advertise", () => {
    const keys = sectionKeys("Logs");
    for (const key of [
      "/",
      "n/N",
      "c",
      "w",
      "r",
      "o",
      "esc",
      "g/G",
      "space",
      "shift ↑/↓",
      "↑/↓  or  j/k",
      "←/→  or  h/l",
    ]) {
      expect(keys).toContain(key);
    }
  });

  test("help text stays short: no semicolons or long dashes", () => {
    const texts = Object.values(KEYBINDS)
      .flat()
      .flatMap(row => (row.kind === "binding" ? [row.desc] : row.kind === "section" ? [row.label] : []));
    for (const text of texts) expect(text).not.toMatch(/[;—–]/);
  });

  test("shift keys are written one way everywhere (`shift ↑/↓`)", () => {
    const all = [...KEYBINDS.general, ...KEYBINDS.commands].flatMap(row => (row.kind === "binding" ? [row.key] : []));
    expect(all.some(key => key.includes("shift +") || key.includes("shift+"))).toBe(false);
  });

  test("provider help uses the menu's section and row names", () => {
    const headers = KEYBINDS.providers.flatMap(row => (row.kind === "section" ? [row.label] : []));
    const menus = [
      buildGitHubProviderItems(
        {
          enabled: true,
          tokenEnvVar: "GITHUB_TOKEN",
          trustedEnterpriseHost: null,
          fetchDepth: 20,
          cacheLimit: 20,
          autoRefreshSeconds: 120,
        },
        "https://github.com/o/r.git",
        "env",
      ),
      buildJenkinsProviderItems({
        enabled: true,
        tokenEnvVar: "JENKINS_TOKEN",
        fetchDepth: 20,
        cacheLimit: 20,
        autoRefreshSeconds: 120,
        jobs: [],
      }),
      buildOpenShiftProviderItems({
        enabled: true,
        serverUrl: "",
        tokenEnvVar: "OPENSHIFT_TOKEN",
        namespaces: [],
        commitShaAnnotation: "dev/commit-sha",
        cacheLimit: 20,
        fetchDepth: 20,
        autoRefreshSeconds: 120,
      }),
      buildSnykProviderItems(
        { enabled: true, tokenEnvVar: "SNYK_TOKEN", autoScanBranches: [], maxCachedScans: 20 },
        () => [],
      ),
    ];
    for (const items of menus) {
      const header = items.find(item => item.kind === "header")?.label ?? "";
      expect(headers).toContain(header);
      const start = KEYBINDS.providers.findIndex(row => row.kind === "section" && row.label === header);
      const end = KEYBINDS.providers.findIndex((row, index) => index > start && row.kind === "section");
      const helpKeys = KEYBINDS.providers
        .slice(start + 1, end < 0 ? undefined : end)
        .flatMap(row => (row.kind === "binding" ? [row.key] : []));
      for (const item of items) {
        if (item.kind === "header" || item.kind === "copyable" || !("label" in item)) continue;
        expect(helpKeys).toContain(item.label);
      }
    }
  });
});
