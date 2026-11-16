import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import { type AppActions, providerError, providerIdle } from "./context/state";
import { createThemeState } from "./context/theme";
import * as dashboardLoad from "./dashboard/load";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

const repo = resolve("/repo/dashboard-errors");

/** Codepulse on the dashboard of one app, without Git or providers: the test sets the providers' statuses. */
async function launch() {
  let actions: AppActions | undefined;
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(configWrite, "writeConfig").mockImplementation(() => true),
    spyOn(config, "loadConfig").mockImplementation(() => ({ config: {}, warnings: [] })),
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
