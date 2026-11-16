import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import type { AppActions, AppState } from "./context/state";
import { createThemeState } from "./context/theme";
import * as dashboardLoad from "./dashboard/load";
import { buildGraph } from "./git/graph";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

test("in the compact layout, Enter on a dashboard event opens its details with its provider's tab, and s shows it there", async () => {
  const repo = resolve("/repo/compact-dashboard");
  let app: { state: AppState; actions: AppActions } | undefined;
  const commits = ["a".repeat(40), "b".repeat(40)].map((hash, index) => ({
    hash,
    shortHash: hash.slice(0, 7),
    parents: index === 0 ? ["b".repeat(40)] : [],
    subject: index === 0 ? "head commit" : "older commit",
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-10-13T10:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-10-13T10:00:00Z",
    refs: [],
  }));
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([
      {
        id: "github-actions:7",
        app: repo,
        source: "github-actions",
        time: Date.now() - 60_000,
        status: "fail",
        text: "CI #812 failed",
        sha: "b".repeat(40),
        url: "https://example.invalid/runs/7",
        facts: [{ label: "Workflow", value: "CI" }],
      },
    ]),
    spyOn(dashboardLoad, "loadCommitInfo").mockResolvedValue(null),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits(commits);
      options.actions.setGraphRows(buildGraph(commits));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(
      () => (
        <AppContent
          repoPath={repo}
          startupMode={{ kind: "graph" }}
          themeState={createThemeState()}
          autoRefreshInterval={0}
          autoFetchInterval={0}
        />
      ),
      // Narrower than COMPACT_THRESHOLD_WIDTH: no side panel, details open as a dialog.
      { width: 110, height: 40, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    const frame = () => setup?.captureCharFrame() ?? "";
    app.actions.setActiveProviderView("dashboard");
    for (let tries = 0; tries < 20 && !frame().includes("CI #812 failed"); tries++) await setup.flush();
    expect(frame()).toContain("CI #812 failed");
    expect(frame()).toContain("enter details");
    expect(frame()).not.toContain("Workflow");

    // Enter: the event's details over the dashboard, with GitHub's own tab, which has the keyboard.
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(frame()).toContain("esc close");
    expect(frame()).toContain("Show in GitHub");
    expect(frame()).toContain("s show in GitHub");
    expect(frame()).not.toContain("Workflow");
    expect(app.state.detailActiveTab()).toBe("github-actions");
    expect(app.state.detailFocused()).toBe(true);
    expect(app.state.activeProviderView()).toBe("dashboard");

    // Esc: back to the dashboard.
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(frame()).not.toContain("esc close");
    expect(app.state.activeProviderView()).toBe("dashboard");

    // Enter, then s: the event's commit in its provider's view (GitHub is off here: Git), with the details dialog.
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    setup.mockInput.pressKey("s");
    for (let tries = 0; tries < 20 && app.state.activeProviderView() === "dashboard"; tries++) await setup.flush();
    expect(app.state.activeProviderView()).toBe("git");
    expect(app.state.cursorIndex()).toBe(1);
    await setup.flush();
    expect(frame()).toContain("esc close");
    expect(frame()).not.toContain("Show in GitHub");
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});

test("beside the events, → gives the provider's tab the keyboard: ←/→ between its tabs, ← on the first back out", async () => {
  const repo = resolve("/repo/wide-dashboard");
  let app: { state: AppState; actions: AppActions } | undefined;
  const sha = "c".repeat(40);
  const commits = [
    {
      hash: sha,
      shortHash: sha.slice(0, 7),
      parents: [],
      subject: "scanned commit",
      body: "",
      author: "Author",
      authorEmail: "author@example.com",
      authorDate: "2026-10-13T10:00:00Z",
      committer: "Author",
      committerEmail: "author@example.com",
      commitDate: "2026-10-13T10:00:00Z",
      refs: [],
    },
  ];
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([
      {
        id: "snyk:scan",
        app: repo,
        source: "snyk",
        time: Date.now() - 60_000,
        status: "fail",
        severity: "high",
        counts: { critical: 0, high: 1, medium: 0, low: 0 },
        text: "scan · 1 vulnerability · 0 critical · 1 high · 0 medium · 0 low",
        sha,
      },
    ]),
    spyOn(dashboardLoad, "loadCommitInfo").mockResolvedValue(null),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits(commits);
      options.actions.setGraphRows(buildGraph(commits));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(
      () => (
        <AppContent
          repoPath={repo}
          startupMode={{ kind: "graph" }}
          themeState={createThemeState()}
          autoRefreshInterval={0}
          autoFetchInterval={0}
        />
      ),
      { width: 200, height: 40, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    const { state } = app;
    const frame = () => setup?.captureCharFrame() ?? "";
    const press = async (key: string) => {
      setup?.mockInput.pressKey(key);
      await setup?.flush();
    };
    app.actions.setActiveProviderView("dashboard");
    for (let tries = 0; tries < 20 && !frame().includes("1 vulnerability"); tries++) await setup.flush();
    expect(frame()).toMatch(/Vulnerabilities\s+Dependencies/);
    expect(frame()).toContain("Show in Snyk");
    expect(state.detailFocused()).toBe(false);

    await press("ARROW_RIGHT");
    expect(state.detailFocused()).toBe(true);
    expect(state.detailActiveTab()).toBe("snyk");
    await press("ARROW_RIGHT");
    expect(state.detailActiveTab()).toBe("snyk-deps");
    await press("ARROW_LEFT");
    expect(state.detailActiveTab()).toBe("snyk");
    // ← on the first tab: the events have the keyboard again, on the same event.
    await press("ARROW_LEFT");
    expect(state.detailFocused()).toBe(false);
    expect(state.activeProviderView()).toBe("dashboard");

    // Enter on the event: its commit in its provider's view (Snyk is off here: Git), with the details focused.
    await press("RETURN");
    for (let tries = 0; tries < 20 && state.activeProviderView() === "dashboard"; tries++) await setup.flush();
    expect(state.activeProviderView()).toBe("git");
    expect(state.detailFocused()).toBe(true);
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});
