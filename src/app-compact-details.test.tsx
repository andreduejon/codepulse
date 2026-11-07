import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
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

test("closing compact Details with the mouse leaves detail focus like Esc does", async () => {
  const repo = resolve("/repo/compact-details");
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
      // Narrower than COMPACT_THRESHOLD_WIDTH: details open as a dialog.
      { width: 110, height: 40, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(app.state.detailFocused()).toBe(true);
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("Details") && line.includes("esc close"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(lines[y].indexOf("esc close") + 1, y);
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("esc close");
    expect(app.state.detailFocused()).toBe(false);
    expect(setup.captureCharFrame()).toContain("details");
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});
