import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type CodepulseConfig, loadConfig, mergeOptions, resolveConfigInfo, writeConfig } from "../src/config";
import { DEFAULT_MAX_COUNT } from "../src/constants";
import { DEFAULT_AUTO_REFRESH_INTERVAL } from "../src/context/state";

const TEST_ROOT = join(tmpdir(), `codepulse-config-test-${Date.now()}`);

function makeTempDir(name: string): string {
  const dir = join(TEST_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTempConfig(name: string, content: unknown): string {
  const dir = makeTempDir(name);
  const path = join(dir, "config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return path;
}

/** Helper: create a config with settings under repos[repoPath]. */
function makeRepoConfig(name: string, repoPath: string, repoConfig: Record<string, unknown>): string {
  return makeTempConfig(name, {
    repos: { [resolve(repoPath)]: repoConfig },
  });
}

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns empty object when config file does not exist", () => {
    const configPath = join(makeTempDir("no-config"), "config.json");
    const { config: result } = loadConfig("/tmp/repo", configPath);
    expect(result).toEqual({});
  });

  test("ignores global top-level fields (repo-only mode)", () => {
    const configPath = makeTempConfig("global-fields", { theme: "gruvbox", pageSize: 100 });
    const { config: result } = loadConfig("/tmp/repo", configPath);
    // Global top-level fields are ignored — only repos[path] entries are read
    expect(result).toEqual({});
  });

  test("loads repo-specific config fields", () => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig("repo-fields", repoPath, { theme: "gruvbox", pageSize: 100 });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result.theme).toBe("gruvbox");
    expect(result.pageSize).toBe(100);
  });

  test("returns empty object for invalid JSON", () => {
    const configPath = makeTempConfig("bad-json", "not json!!!");
    const { config: result, warnings } = loadConfig("/tmp/repo", configPath);
    expect(result).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("returns empty object when config is an array", () => {
    const configPath = makeTempConfig("array-config", "[1, 2, 3]");
    const { config: result, warnings } = loadConfig("/tmp/repo", configPath);
    expect(result).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("returns empty object when config is null", () => {
    const configPath = makeTempConfig("null-config", "null");
    const { config: result, warnings } = loadConfig("/tmp/repo", configPath);
    expect(result).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("validates all config fields", () => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig("full-config", repoPath, {
      theme: "catppuccin-latte",
      pageSize: 500,
      branch: "develop",
      showAllBranches: false,
      autoRefreshSeconds: 10,
    });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result).toEqual({
      theme: "catppuccin-latte",
      pageSize: 500,
      branch: "develop",
      showAllBranches: false,
      autoRefreshSeconds: 10,
    });
  });

  test.each([
    { label: "theme (not a string)", config: { theme: 42 }, field: "theme" as const, hasWarning: true },
    { label: "empty theme string", config: { theme: "" }, field: "theme" as const, hasWarning: false },
    { label: "pageSize (non-integer)", config: { pageSize: 1.5 }, field: "pageSize" as const, hasWarning: false },
    { label: "pageSize (zero)", config: { pageSize: 0 }, field: "pageSize" as const, hasWarning: false },
    { label: "pageSize (negative)", config: { pageSize: -10 }, field: "pageSize" as const, hasWarning: false },
    { label: "branch (empty string)", config: { branch: "" }, field: "branch" as const, hasWarning: false },
    {
      label: "showAllBranches (not boolean)",
      config: { showAllBranches: "yes" },
      field: "showAllBranches" as const,
      hasWarning: false,
    },
    {
      label: "autoRefreshSeconds (negative)",
      config: { autoRefreshSeconds: -5 },
      field: "autoRefreshSeconds" as const,
      hasWarning: false,
    },
  ])("drops invalid $label", ({ config, field, hasWarning }) => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig(`bad-${field}`, repoPath, config);
    const { config: result, warnings } = loadConfig(repoPath, configPath);
    expect(result[field]).toBeUndefined();
    if (hasWarning) expect(warnings.length).toBeGreaterThan(0);
  });

  test("allows autoRefreshSeconds of 0 (off)", () => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig("refresh-zero", repoPath, { autoRefreshSeconds: 0 });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result.autoRefreshSeconds).toBe(0);
  });

  test("ignores unknown keys silently", () => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig("unknown-keys", repoPath, { theme: "nord", unknownKey: true, foo: "bar" });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result).toEqual({ theme: "nord" });
    expect((result as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  test("keeps valid fields and drops invalid ones in same config", () => {
    const repoPath = "/tmp/repo";
    const configPath = makeRepoConfig("mixed-validity", repoPath, {
      theme: "dracula",
      pageSize: -1,
      branch: "main",
      showAllBranches: 42,
    });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result.theme).toBe("dracula");
    expect(result.pageSize).toBeUndefined();
    expect(result.branch).toBe("main");
    expect(result.showAllBranches).toBeUndefined();
  });

  test("reads only from repos[path], ignoring global top-level", () => {
    const repoPath = "/tmp/my-repo";
    const configPath = makeTempConfig("repo-overrides", {
      theme: "catppuccin-mocha",
      pageSize: 200,
      repos: {
        [resolve(repoPath)]: {
          pageSize: 500,
          branch: "develop",
        },
      },
    });
    const { config: result } = loadConfig(repoPath, configPath);
    // Global top-level theme is NOT inherited — only repo entry fields
    expect(result.theme).toBeUndefined();
    expect(result.pageSize).toBe(500);
    expect(result.branch).toBe("develop");
  });

  test("returns empty config when repos map has no entry for this repo", () => {
    const configPath = makeTempConfig("repo-miss", {
      theme: "gruvbox",
      repos: {
        "/some/other/repo": { pageSize: 999 },
      },
    });
    const { config: result } = loadConfig("/tmp/my-repo", configPath);
    // No entry for this repo — returns empty (global top-level ignored)
    expect(result).toEqual({});
  });

  test("validates repo-specific config fields", () => {
    const repoPath = "/tmp/my-repo";
    const configPath = makeRepoConfig("repo-invalid", repoPath, {
      pageSize: -1,
      branch: "main",
    });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result.pageSize).toBeUndefined();
    expect(result.branch).toBe("main");
  });

  test("ignores repos key that is not an object", () => {
    const configPath = makeTempConfig("repos-not-obj", {
      theme: "nord",
      repos: "invalid",
    });
    const { config: result } = loadConfig("/tmp/repo", configPath);
    expect(result).toEqual({});
  });

  test("ignores repo entry that is not an object", () => {
    const repoPath = "/tmp/my-repo";
    const configPath = makeTempConfig("repo-entry-invalid", {
      theme: "nord",
      repos: {
        [resolve(repoPath)]: "not an object",
      },
    });
    const { config: result } = loadConfig(repoPath, configPath);
    expect(result).toEqual({});
  });
});

describe("mergeOptions", () => {
  const emptyConfig: CodepulseConfig = {};

  test("all defaults when no CLI and no config", () => {
    const result = mergeOptions({ repoPath: "/tmp/repo" }, emptyConfig);
    expect(result).toEqual({
      repoPath: "/tmp/repo",
      branch: undefined,
      all: true,
      maxCount: DEFAULT_MAX_COUNT,
      themeName: "catppuccin-mocha",
      autoRefreshInterval: DEFAULT_AUTO_REFRESH_INTERVAL,
      path: undefined,
    });
  });

  test("CLI values override everything", () => {
    const result = mergeOptions(
      { repoPath: "/repo", branch: "feature", all: false, maxCount: 50, themeName: "nord" },
      { theme: "gruvbox", pageSize: 300, branch: "main", showAllBranches: true, autoRefreshSeconds: 60 },
    );
    expect(result.branch).toBe("feature");
    expect(result.all).toBe(false);
    expect(result.maxCount).toBe(50);
    expect(result.themeName).toBe("nord");
  });

  test("config values used when CLI fields are undefined", () => {
    const result = mergeOptions(
      { repoPath: "/repo" },
      { theme: "gruvbox", pageSize: 300, branch: "develop", showAllBranches: false, autoRefreshSeconds: 10 },
    );
    expect(result.branch).toBe("develop");
    expect(result.all).toBe(false);
    expect(result.maxCount).toBe(300);
    expect(result.themeName).toBe("gruvbox");
    expect(result.autoRefreshInterval).toBe(10000);
  });

  test("config showAllBranches respected when no CLI branch and no CLI all", () => {
    const result = mergeOptions({ repoPath: "/repo" }, { showAllBranches: true });
    expect(result.all).toBe(true);
    expect(result.branch).toBeUndefined();
  });

  test("config showAllBranches=false without branch", () => {
    const result = mergeOptions({ repoPath: "/repo" }, { showAllBranches: false });
    expect(result.all).toBe(false);
    expect(result.branch).toBeUndefined();
  });

  test("--branch implies all=false even with config showAllBranches=true", () => {
    const result = mergeOptions({ repoPath: "/repo", branch: "main" }, { showAllBranches: true });
    expect(result.branch).toBe("main");
    expect(result.all).toBe(false);
  });

  test("CLI --no-all overrides config showAllBranches", () => {
    const result = mergeOptions({ repoPath: "/repo", all: false }, { showAllBranches: true });
    expect(result.all).toBe(false);
  });

  test("config branch used when CLI branch is undefined", () => {
    const result = mergeOptions({ repoPath: "/repo" }, { branch: "release" });
    expect(result.branch).toBe("release");
    expect(result.all).toBe(false);
  });

  test("autoRefreshSeconds=0 in config produces 0ms interval", () => {
    const result = mergeOptions({ repoPath: "/repo" }, { autoRefreshSeconds: 0 });
    expect(result.autoRefreshInterval).toBe(0);
  });

  test("default autoRefreshInterval used when config has no autoRefreshSeconds", () => {
    const result = mergeOptions({ repoPath: "/repo" }, {});
    expect(result.autoRefreshInterval).toBe(DEFAULT_AUTO_REFRESH_INTERVAL);
  });

  test("default theme is catppuccin-mocha", () => {
    const result = mergeOptions({ repoPath: "/repo" }, {});
    expect(result.themeName).toBe("catppuccin-mocha");
  });

  test("default maxCount is DEFAULT_MAX_COUNT", () => {
    const result = mergeOptions({ repoPath: "/repo" }, {});
    expect(result.maxCount).toBe(DEFAULT_MAX_COUNT);
  });

  test("CLI path is passed through", () => {
    const result = mergeOptions({ repoPath: "/repo", path: "src/" }, {});
    expect(result.path).toBe("src/");
  });
});

describe("resolveConfigInfo", () => {
  test("returns globalPath matching the provided configPath", () => {
    const dir = makeTempDir("resolve-info");
    const configPath = join(dir, "config.json");
    const result = resolveConfigInfo("/tmp/repo", configPath);
    expect(result.globalPath).toBe(configPath);
  });

  test("reports globalExists=false when config does not exist", () => {
    const configPath = join(makeTempDir("resolve-missing"), "config.json");
    const result = resolveConfigInfo("/tmp/repo", configPath);
    expect(result.globalExists).toBe(false);
    expect(result.hasRepoOverrides).toBe(false);
  });

  test("reports globalExists=true when config exists", () => {
    const configPath = makeTempConfig("resolve-exists", { theme: "nord" });
    const result = resolveConfigInfo("/tmp/repo", configPath);
    expect(result.globalExists).toBe(true);
  });

  test("detects repo overrides when present in config", () => {
    const repoPath = "/tmp/my-repo";
    const configPath = makeTempConfig("resolve-repo", {
      repos: {
        [resolve(repoPath)]: { pageSize: 500 },
      },
    });
    const result = resolveConfigInfo(repoPath, configPath);
    expect(result.hasRepoOverrides).toBe(true);
  });

  test("hasRepoOverrides=false when repos map has no entry for this repo", () => {
    const configPath = makeTempConfig("resolve-no-repo", {
      repos: {
        "/some/other/repo": { pageSize: 100 },
      },
    });
    const result = resolveConfigInfo("/tmp/my-repo", configPath);
    expect(result.hasRepoOverrides).toBe(false);
  });

  test("hasRepoOverrides=false when repos key is not an object", () => {
    const configPath = makeTempConfig("resolve-repos-bad", {
      repos: "invalid",
    });
    const result = resolveConfigInfo("/tmp/my-repo", configPath);
    expect(result.hasRepoOverrides).toBe(false);
  });

  test("handles corrupt config file gracefully", () => {
    const configPath = makeTempConfig("resolve-corrupt", "not json!!!");
    const result = resolveConfigInfo("/tmp/repo", configPath);
    expect(result.globalExists).toBe(true);
    expect(result.hasRepoOverrides).toBe(false);
  });
});

describe("writeConfig", () => {
  test("creates new config file with repo entry", () => {
    const dir = makeTempDir("write-new");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ theme: "nord", pageSize: 100 }, repoPath, configPath);
    expect(result).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].theme).toBe("nord");
    expect(content.repos[resolve(repoPath)].pageSize).toBe(100);
  });

  test("creates parent directories when they do not exist", () => {
    const dir = makeTempDir("write-nested");
    const configPath = join(dir, "deep", "nested", "config.json");
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ theme: "gruvbox" }, repoPath, configPath);
    expect(result).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].theme).toBe("gruvbox");
  });

  test("merges with existing file preserving unknown top-level keys", () => {
    const dir = makeTempDir("write-merge");
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ customKey: "preserve-me" }, null, 2));
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ theme: "catppuccin-mocha", pageSize: 200 }, repoPath, configPath);
    expect(result).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.customKey).toBe("preserve-me");
    expect(content.repos[resolve(repoPath)].theme).toBe("catppuccin-mocha");
    expect(content.repos[resolve(repoPath)].pageSize).toBe(200);
  });

  test("overwrites corrupt existing file", () => {
    const dir = makeTempDir("write-corrupt");
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, "not valid json!!!");
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ theme: "dracula" }, repoPath, configPath);
    expect(result).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].theme).toBe("dracula");
  });

  test("overwrites existing file that is an array", () => {
    const dir = makeTempDir("write-array");
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify([1, 2, 3]));
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ pageSize: 500 }, repoPath, configPath);
    expect(result).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].pageSize).toBe(500);
    expect(Array.isArray(content)).toBe(false);
  });

  test("writes JSON with 2-space indent and trailing newline", () => {
    const dir = makeTempDir("write-format");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/my-repo";
    writeConfig({ theme: "nord" }, repoPath, configPath);
    const raw = readFileSync(configPath, "utf-8");
    expect(raw).toContain('"theme": "nord"');
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("only writes config fields that are defined", () => {
    const dir = makeTempDir("write-partial");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/my-repo";
    writeConfig({ theme: "nord" }, repoPath, configPath);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    const entry = content.repos[resolve(repoPath)];
    expect(entry.theme).toBe("nord");
    expect(entry.pageSize).toBeUndefined();
    expect(entry.branch).toBeUndefined();
    expect(entry.showAllBranches).toBeUndefined();
    expect(entry.autoRefreshSeconds).toBeUndefined();
  });

  test("writes under repos map keyed by absolute path", () => {
    const dir = makeTempDir("write-repo");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/my-repo";
    const result = writeConfig({ pageSize: 500, branch: "develop" }, repoPath, configPath);
    expect(result).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].pageSize).toBe(500);
    expect(content.repos[resolve(repoPath)].branch).toBe("develop");
  });

  test("preserves existing top-level data in config file", () => {
    const dir = makeTempDir("write-repo-preserve");
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ legacyKey: "old-value" }, null, 2));
    const repoPath = "/tmp/my-repo";
    writeConfig({ pageSize: 500 }, repoPath, configPath);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.legacyKey).toBe("old-value");
    expect(content.repos[resolve(repoPath)].pageSize).toBe(500);
  });

  test("preserves other repo entries", () => {
    const dir = makeTempDir("write-repo-others");
    const configPath = join(dir, "config.json");
    const otherRepo = "/tmp/other-repo";
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repos: {
            [resolve(otherRepo)]: { pageSize: 100 },
          },
        },
        null,
        2,
      ),
    );
    const myRepo = "/tmp/my-repo";
    writeConfig({ pageSize: 500 }, myRepo, configPath);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(otherRepo)].pageSize).toBe(100);
    expect(content.repos[resolve(myRepo)].pageSize).toBe(500);
  });

  test("merges with existing repo entry", () => {
    const dir = makeTempDir("write-repo-merge");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/my-repo";
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repos: {
            [resolve(repoPath)]: { branch: "main", pageSize: 200 },
          },
        },
        null,
        2,
      ),
    );
    writeConfig({ pageSize: 500 }, repoPath, configPath);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.repos[resolve(repoPath)].branch).toBe("main");
    expect(content.repos[resolve(repoPath)].pageSize).toBe(500);
  });

  test("round-trip: writeConfig then loadConfig reads back same values", () => {
    const dir = makeTempDir("write-roundtrip");
    const configPath = join(dir, "config.json");
    const repoPath = "/tmp/repo";
    const original: CodepulseConfig = {
      theme: "catppuccin-latte",
      pageSize: 300,
      branch: "develop",
      showAllBranches: false,
      autoRefreshSeconds: 60,
    };
    writeConfig(original, repoPath, configPath);
    const { config: loaded } = loadConfig(repoPath, configPath);
    expect(loaded).toEqual(original);
  });

  test("round-trip: multiple repos with independent settings", () => {
    const dir = makeTempDir("write-roundtrip-multi");
    const configPath = join(dir, "config.json");
    const repo1 = "/tmp/repo-a";
    const repo2 = "/tmp/repo-b";
    writeConfig({ theme: "nord", pageSize: 200 }, repo1, configPath);
    writeConfig({ pageSize: 500, branch: "develop" }, repo2, configPath);
    const { config: loaded1 } = loadConfig(repo1, configPath);
    const { config: loaded2 } = loadConfig(repo2, configPath);
    expect(loaded1.theme).toBe("nord");
    expect(loaded1.pageSize).toBe(200);
    expect(loaded1.branch).toBeUndefined();
    expect(loaded2.theme).toBeUndefined();
    expect(loaded2.pageSize).toBe(500);
    expect(loaded2.branch).toBe("develop");
  });
});
