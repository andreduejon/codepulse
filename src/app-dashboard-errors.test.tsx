import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import { type AppActions, providerError, providerIdle } from "./context/state";
import { createThemeState } from "./context/theme";
import { clearDebugEvents, getDebugEvents } from "./core/debug-events";
import * as dashboardLoad from "./dashboard/load";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

const repo = resolve("/repo/dashboard-errors");

/** Codepulse on the dashboard of one app, without Git or providers: the test sets the providers' statuses. */
async function launch(repoConfig: config.CodepulseConfig = {}, warnings: string[] = []) {
  let actions: AppActions | undefined;
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(configWrite, "writeConfig").mockImplementation(() => true),
    spyOn(config, "loadConfig").mockImplementation(() => ({ config: repoConfig, warnings })),
    spyOn(config, "getRepoDisplayConfig").mockImplementation(() => ({ group: "shop", appName: "first-app" })),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo, group: "shop", appName: "first-app" }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([]),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      actions = options.actions;
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
      { width: 200, height: 50, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!actions) throw new Error("App fixture did not initialize");
    return { actions, setup, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("the dashboard shows its providers' fetch errors in one box, until closed or the error changes", async () => {
  const { actions, setup, dispose } = await launch();
  const frame = async () => {
    await setup.flush();
    return setup.captureCharFrame();
  };
  try {
    actions.setProviderStatus("github-actions", providerError("GitHub rate limit exceeded."));
    // On the Git view, another provider's error stays on its own tab.
    expect(await frame()).not.toContain("GitHub rate limit exceeded.");

    actions.setActiveProviderView("dashboard");
    // Worded as on the GitHub tab: the source moves after the headline.
    expect(await frame()).toContain("Rate limit exceeded · GitHub");
    actions.setProviderStatus("jenkins", providerError("Jenkins request timed out."));
    let shown = await frame();
    expect(shown).toContain("Errors from GitHub and Jenkins");
    expect(shown).toContain("GitHub rate limit exceeded.");
    expect(shown).toContain("Jenkins request timed out.");

    // :clear closes it; the same errors on the next auto refresh stay closed.
    setup.mockInput.pressKey(":");
    await setup.mockInput.typeText("clear");
    setup.mockInput.pressEnter();
    expect(await frame()).not.toContain("Errors from");
    actions.setProviderStatus("jenkins", providerError("Jenkins request timed out."));
    expect(await frame()).not.toContain("Jenkins request timed out.");

    // A new error shows, alone.
    actions.setProviderStatus("jenkins", providerError("Jenkins fetch failed."));
    shown = await frame();
    expect(shown).toContain("Fetch failed · Jenkins");
    expect(shown).not.toMatch(/rate limit exceeded/i);

    // Once GitHub recovers, its next failure shows again.
    actions.setProviderStatus("github-actions", providerIdle());
    actions.setProviderStatus("github-actions", providerError("GitHub rate limit exceeded."));
    expect(await frame()).toContain("GitHub rate limit exceeded.");
    expect(await frame()).toContain("Errors from GitHub and Jenkins");
  } finally {
    await dispose();
  }
});

test("a dashboard turned off has no tab, and a repository set to start in it starts in Git", async () => {
  const { actions, setup, dispose } = await launch({ startView: "dashboard", dashboard: { enabled: false } });
  try {
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Dashboard");
    expect(frame).toMatch(/Graph\s+Commit\s+Description/);
    // Tab cycles without it.
    actions.setActiveProviderView("git");
    setup.mockInput.pressTab();
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Event");
  } finally {
    await dispose();
  }
});

test("turning the dashboard off in the menu while it is shown goes back to Git", async () => {
  const { setup, dispose } = await launch({ startView: "dashboard" });
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toMatch(/Graph\s+Commit\s+Branch\s+Time\s+Event/);
    setup.mockInput.pressKey("m");
    await setup.flush();
    for (let step = 0; step < 6 && !setup.captureCharFrame().includes("Time window"); step++) {
      setup.mockInput.pressArrow("right");
      await setup.flush();
    }
    const menu = setup.captureCharFrame().split("\n");
    const row = menu.findIndex(line => line.includes("Enabled"));
    expect(row).toBeGreaterThan(0);
    await setup.mockMouse.click(menu[row]?.indexOf("Enabled") ?? 0, row);
    await setup.flush();
    setup.mockInput.pressEscape();
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Dashboard");
    expect(frame).toMatch(/Graph\s+Commit\s+Description/);
    expect(configWrite.writeConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashboard: expect.objectContaining({ enabled: false }) }),
      repo,
    );
  } finally {
    await dispose();
  }
});

test("the config's warnings show in Debug", async () => {
  clearDebugEvents();
  const warning = '/home/me/.config/codepulse/config.json: "dashboard.enabled" must be a boolean, ignoring';
  const { setup, dispose } = await launch({}, [warning]);
  try {
    expect(getDebugEvents().map(event => event.message)).toContain(warning);
    setup.mockInput.pressKey(":");
    await setup.mockInput.typeText("debug");
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain('"dashboard.enabled" must be a boolean');
  } finally {
    await dispose();
    clearDebugEvents();
  }
});

test("a Snyk failure stays in the dashboard's box while Snyk still reports it, also after visiting its tab", async () => {
  const { actions, setup, dispose } = await launch();
  try {
    actions.setProviderStatus("snyk", providerError("Snyk CLI not found."));
    actions.setActiveProviderView("dashboard");
    await setup.flush();
    expect(setup.captureCharFrame()).toMatch(/Snyk CLI not found|CLI not found · Snyk/);
  } finally {
    await dispose();
  }
});
