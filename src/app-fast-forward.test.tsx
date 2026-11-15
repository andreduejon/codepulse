import { expect, mock, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import type { AppActions, AppState } from "./context/state";
import { createThemeState } from "./context/theme";
import * as dashboardLoad from "./dashboard/load";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

const repo = resolve("/repo/fast-forward");
const other = resolve("/repo/fast-forward-other");

type LoaderOptions = Parameters<typeof dataLoader.useDataLoader>[0];

/** Codepulse in Git on two apps of one group, without Git: the loader's options and its fetches are kept. */
async function launch(configFor: (path: string) => config.CodepulseConfig = () => ({})) {
  let app: { state: AppState; actions: AppActions; options: LoaderOptions } | undefined;
  const handleFetch = mock(async (_mode?: "fetch" | "pull") => {});
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(configWrite, "writeConfig").mockImplementation(() => true),
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
      app = { state: options.state, actions: options.actions, options };
      options.actions.setRepoPath(repo);
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch };
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
      { width: 200, height: 70, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    return { app, setup, handleFetch, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("ctrl+f fetches and fast-forwards, f only fetches", async () => {
  const { setup, handleFetch, dispose } = await launch();
  try {
    setup.mockInput.pressKey("f", { ctrl: true });
    await setup.flush();
    expect(handleFetch.mock.calls).toEqual([["pull"]]);
    setup.mockInput.pressKey("f");
    await setup.flush();
    expect(handleFetch.mock.calls).toEqual([["pull"], []]);
  } finally {
    await dispose();
  }
});

test("ctrl+f says what moved; after f, only a branch left behind shows, once", async () => {
  const { app, setup, dispose } = await launch();
  try {
    const report = app.options.onFastForward;
    if (!report) throw new Error("no fast-forward report");
    report({ moved: [{ branch: "main", commits: 3 }], skipped: [] }, true);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Fast-forwarded main by 3 commits");

    // f with the setting on: the same warning comes back only when something changed.
    const behind = { moved: [], skipped: [{ branch: "main", reason: "local-changes" as const }] };
    report(behind, false);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("main not fast-forwarded");
    expect(setup.captureCharFrame()).toContain("main is checked out and has local changes.");
    setup.mockInput.pressKey(":");
    await setup.mockInput.typeText("clear");
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("main not fast-forwarded");
    report(behind, false);
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("main not fast-forwarded");

    // Once main moves, nothing is left to say.
    report({ moved: [], skipped: [{ branch: "dev", reason: "diverged" }] }, false);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("dev not fast-forwarded");
    report({ moved: [{ branch: "dev", commits: 1 }], skipped: [] }, false);
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("dev not fast-forwarded");
  } finally {
    await dispose();
  }
});

test("Auto fast-forward is per repository, off by default, and saved from the menu", async () => {
  const { app, setup, dispose } = await launch(path => (path === other ? { autoFastForward: true } : {}));
  try {
    expect(app.options.autoFastForward?.()).toBe(false);
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("other-app"));
    await setup.mockMouse.click(lines[y]?.indexOf("other-app") ?? 0, y);
    await setup.flush();
    expect(app.state.repoPath()).toBe(other);
    expect(app.options.autoFastForward?.()).toBe(true);

    setup.mockInput.pressKey("m");
    await setup.flush();
    expect(setup.captureCharFrame()).toMatch(/Fast-forward\s+ctrl\+f/);
    // Down until the setting shows, right below Auto fetch; a click turns it off.
    for (let step = 0; step < 40 && !setup.captureCharFrame().includes("Auto fast-forward"); step++) {
      setup.mockInput.pressKey("down");
      await setup.flush();
    }
    const menu = setup.captureCharFrame().split("\n");
    const row = menu.findIndex(line => line.includes("Auto fast-forward"));
    expect(row - 1).toBe(menu.findIndex(line => line.includes("Auto fetch")));
    expect(menu[row]).toContain("on");
    await setup.mockMouse.click(menu[row]?.indexOf("Auto fast-forward") ?? 0, row);
    await setup.flush();
    expect(app.options.autoFastForward?.()).toBe(false);
    expect(configWrite.writeConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoFastForward: false }),
      other,
    );
  } finally {
    await dispose();
  }
});
