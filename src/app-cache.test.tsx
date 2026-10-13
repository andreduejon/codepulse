import { expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import type { AppActions, AppState } from "./context/state";
import { createThemeState } from "./context/theme";
import { buildGraph } from "./git/graph";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";
import * as githubHook from "./providers/github-actions/use-github-ci";
import * as management from "./providers/shared/cache-management";
import { closeProviderCaches, providerCacheDatabase, ShaSqliteCache } from "./providers/shared/sha-sqlite-cache";

test(":cache groups apps, resets and evicts only selected repository, then restores repository view", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-app-cache-test-"));
  const current = resolve("/repo/current-cache");
  const other = resolve("/repo/other-cache");
  const sha = "a".repeat(40);
  const store = new ShaSqliteCache<{ sha: string }>({
    root,
    provider: "github-actions",
    isEntry: (value): value is { sha: string } =>
      !!value && typeof value === "object" && "sha" in value && typeof value.sha === "string",
    invalidMessage: "bad fixture",
  });
  await store.write(current, { sha });
  await store.write(other, { sha });
  const jenkins = new ShaSqliteCache<{ sha: string }>({
    root,
    provider: "jenkins",
    isEntry: (value): value is { sha: string } =>
      !!value && typeof value === "object" && "sha" in value && typeof value.sha === "string",
    invalidMessage: "bad fixture",
  });
  await jenkins.write(current, { sha });
  const db = providerCacheDatabase(root);
  db.query("UPDATE snapshots SET accessed_at = ? WHERE repo_path = ?").run(Date.now() - 10_000, current);
  const realSummary = management.getProviderCacheSummary;
  const realReset = management.resetRepositoryCacheTimer;
  const realEvict = management.evictRepositoryCache;
  const realGithub = githubHook.useGitHubCI;
  const invalidate = mock(() => {});
  const summary = spyOn(management, "getProviderCacheSummary").mockImplementation(() => realSummary(root));
  const resetTimer = spyOn(management, "resetRepositoryCacheTimer").mockImplementation((hash, _root, now) =>
    realReset(hash, root, now),
  );
  const evict = spyOn(management, "evictRepositoryCache").mockImplementation(hash => realEvict(hash, root));
  const gh = spyOn(githubHook, "useGitHubCI").mockImplementation(options => {
    const hook = realGithub(options);
    const reset = hook.invalidate;
    hook.invalidate = () => {
      invalidate();
      reset();
    };
    return hook;
  });
  const backfill = spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {});
  const loadConfig = spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] });
  const displayConfig = spyOn(config, "getRepoDisplayConfig").mockReturnValue({});
  const known = spyOn(config, "getKnownRepoInfos").mockReturnValue([]);
  const detail = spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {});
  const title = spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {});
  let app: { state: AppState; actions: AppActions } | undefined;
  const loader = spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
    app = { state: options.state, actions: options.actions };
    const commits = [sha, "b".repeat(40)].map((hash, index) => ({
      hash,
      shortHash: hash.slice(0, 7),
      parents: index === 0 ? ["b".repeat(40)] : [],
      subject: index === 0 ? "head commit" : "selected commit",
      body: "",
      author: "Author",
      authorEmail: "author@example.com",
      authorDate: "2026-10-13T10:00:00Z",
      committer: "Author",
      committerEmail: "author@example.com",
      commitDate: "2026-10-13T10:00:00Z",
      refs: [],
    }));
    options.actions.setRepoPath(current);
    options.actions.setCommits(commits);
    options.actions.setGraphRows(buildGraph(commits));
    options.actions.setCurrentBranch("main");
    options.actions.setCursorIndex(1);
    options.actions.setScrollTargetIndex(1);
    options.actions.setLoading(false);
    return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
  });
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(
      () => (
        <AppContent
          repoPath={current}
          startupMode={{ kind: "graph" }}
          themeState={createThemeState()}
          autoRefreshInterval={0}
          autoFetchInterval={0}
        />
      ),
      {
        width: 110,
        height: 40,
        kittyKeyboard: true,
        useMouse: true,
      },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    app.actions.setSearchQuery("selected");
    app.state.providers.register({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    await setup.flush();
    const original = {
      path: app.state.repoPath(),
      cursor: app.state.cursorIndex(),
      branch: app.state.currentBranch(),
      search: app.state.searchQuery(),
      view: app.state.activeProviderView(),
    };
    setup.mockInput.pressKey(":");
    await setup.mockInput.typeText("cache");
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("shift+r");
    expect(setup.captureCharFrame()).toContain("other-cache");
    expect(app.state.keyboardScopeOverride()).toBe("cache");
    setup.mockInput.pressKey("g");
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    const count = app.state.cursorIndex();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(app.state.cursorIndex()).toBe(count);
    setup.mockInput.pressKey("ARROW_UP");
    setup.mockInput.pressKey("r", { shift: true });
    await setup.flush();
    setup.resize(80, 24);
    await setup.flush();
    expect(app.state.keyboardScopeOverride()).toBe("cache");
    expect(setup.captureCharFrame()).toContain("confirm");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_RIGHT", { shift: true });
    await setup.flush();
    expect(app.state.activeProviderView()).toBe(original.view);
    expect(app.state.repoPath()).toBe(original.path);
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(app.state.searchQuery()).toBe(original.search);
    expect(setup.captureCharFrame()).toContain("shift+r");
    expect(resetTimer).not.toHaveBeenCalled();
    setup.resize(110, 40);
    await setup.flush();
    resetTimer.mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    setup.mockInput.pressKey("r");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Reset failed: database is locked");
    expect(invalidate).not.toHaveBeenCalled();
    expect(realSummary(root).groups).toHaveLength(3);
    resetTimer.mockClear();
    const started = Date.now();
    setup.mockInput.pressKey("r");
    await setup.flush();
    expect(invalidate).not.toHaveBeenCalled();
    expect(resetTimer).toHaveBeenCalledTimes(1);
    expect(
      realSummary(root)
        .groups.filter(group => group.repoPath === current)
        .every(group => group.cleanupAt >= started + management.CACHE_INACTIVITY_MS),
    ).toBe(true);
    expect(realSummary(root).groups).toHaveLength(3);
    evict.mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    setup.mockInput.pressKey("e");
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Eviction failed: database is locked");
    expect(invalidate).not.toHaveBeenCalled();
    expect(realSummary(root).groups).toHaveLength(3);
    evict.mockClear();
    setup.mockInput.pressKey("e");
    await setup.flush();
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(evict).not.toHaveBeenCalled();
    expect(app.state.keyboardScopeOverride()).toBe("cache");
    setup.mockInput.pressKey("e");
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledTimes(1);
    expect(realSummary(root).groups.map(group => group.repoPath)).toEqual([other]);
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("shift+r");
    expect(app.state.keyboardScopeOverride()).toBeNull();
    expect({
      path: app.state.repoPath(),
      cursor: app.state.cursorIndex(),
      branch: app.state.currentBranch(),
      search: app.state.searchQuery(),
      view: app.state.activeProviderView(),
    }).toEqual(original);
    expect(setup.captureCharFrame()).toContain("selected commit");
    const beforeMenu = realSummary(root);
    setup.mockInput.pressKey(":");
    await setup.mockInput.typeText("repo");
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("Cache"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(lines[y].indexOf("Cache") + 1, y);
    await setup.flush();
    expect(app.state.keyboardScopeOverride()).toBe("cache");
    expect(setup.captureCharFrame()).toContain("General");
    expect(setup.captureCharFrame()).toContain("Cache data");
    expect(setup.captureCharFrame()).not.toContain("Preferences");
    expect(realSummary(root)).toEqual(beforeMenu);
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(app.state.keyboardScopeOverride()).toBeNull();
    expect(setup.captureCharFrame()).toContain("selected commit");
    expect(setup.captureCharFrame()).not.toContain("Preferences");
    expect(app.state.cursorIndex()).toBe(original.cursor);
    expect(app.state.searchQuery()).toBe(original.search);
  } finally {
    await setup?.dispose();
    for (const spy of [
      summary,
      resetTimer,
      evict,
      gh,
      backfill,
      loadConfig,
      displayConfig,
      known,
      detail,
      title,
      loader,
    ])
      spy.mockRestore();
    closeProviderCaches(root);
    await rm(root, { recursive: true, force: true });
  }
});
