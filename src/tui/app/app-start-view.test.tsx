import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import * as dashboardLoad from "../../adapters/dashboard/load";
import * as config from "../../adapters/settings/config";
import * as configWrite from "../../adapters/settings/config-write";
import type { CodepulseConfig } from "../../core/settings/config";
import type { AppActions, AppState } from "../context/state";
import { createThemeState } from "../context/theme";
import * as dataLoader from "../hooks/use-data-loader";
import * as detailLoader from "../hooks/use-detail-loader";
import { AppContent } from "./app-content";

const repo = resolve("/repo/start-view");
const other = resolve("/repo/start-view-other");

/** Codepulse on two apps of one group, both starting in the Dashboard unless told otherwise, without Git or provider data. */
async function launch(configFor: (path: string) => CodepulseConfig = () => ({ startView: "dashboard" })) {
  let app: { state: AppState; actions: AppActions } | undefined;
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockImplementation(path => ({ config: configFor(resolve(path ?? "")), warnings: [] })),
    spyOn(config, "getRepoDisplayConfig").mockImplementation(path => ({
      group: "shop",
      appName: path === other ? "other-app" : "first-app",
    })),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([
      { path: repo, group: "shop", appName: "first-app" },
      { path: other, group: "shop", appName: "other-app" },
    ]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([]),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  const dispose = async () => {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  };
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
    return { app, setup, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("codepulse starts in the repository's start view, and another app opens in its own the first time", async () => {
  const { app, setup, dispose } = await launch();
  try {
    expect(app.state.activeProviderView()).toBe("dashboard");

    // From Git, its group badge: the other app, not shown yet, opens in its own start view.
    app.actions.setActiveProviderView("git");
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("other-app"));
    await setup.mockMouse.click(lines[y]?.indexOf("other-app") ?? 0, y);
    await setup.flush();
    expect(app.state.repoPath()).toBe(other);
    expect(app.state.activeProviderView()).toBe("dashboard");
  } finally {
    await dispose();
  }
});

test("on the dashboard, / opens no graph search and Esc keeps the graph's search", async () => {
  const { app, setup, dispose } = await launch();
  try {
    setup.mockInput.pressKey("/");
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Search commits...");
    app.actions.setSearchQuery("fix");
    await setup.flush();
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(app.state.searchQuery()).toBe("fix");
    expect(app.state.activeProviderView()).toBe("dashboard");
  } finally {
    await dispose();
  }
});

test("the graph's search bar closes when the dashboard shows", async () => {
  const { app, setup, dispose } = await launch();
  try {
    app.actions.setActiveProviderView("git");
    await setup.flush();
    setup.mockInput.pressKey("/");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Search commits...");
    // A click on the Dashboard tab, while the search bar is open.
    app.actions.setActiveProviderView("dashboard");
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Search commits...");
  } finally {
    await dispose();
  }
});

test("another repository brings its own auto fetch, auto refresh, page size and branches", async () => {
  const { app, setup, dispose } = await launch(path =>
    path === other
      ? { autoFetchSeconds: 60, autoRefreshSeconds: 120, pageSize: 500, showAllBranches: false, branch: "release" }
      : { autoFetchSeconds: 0, autoRefreshSeconds: 30, pageSize: 200, showAllBranches: true },
  );
  try {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("other-app"));
    await setup.mockMouse.click(lines[y]?.indexOf("other-app") ?? 0, y);
    await setup.flush();
    expect(app.state.repoPath()).toBe(other);
    expect(app.state.autoFetchInterval()).toBe(60_000);
    expect(app.state.autoRefreshInterval()).toBe(120_000);
    expect(app.state.maxCount()).toBe(500);
    expect(app.state.showAllBranches()).toBe(false);
    // Its configured branch: the graph's branch view, so every page and refresh keeps to it.
    expect(app.state.viewingBranch()).toBe("release");
  } finally {
    await dispose();
  }
});
