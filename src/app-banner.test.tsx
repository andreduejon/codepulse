import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import { createThemeState } from "./context/theme";
import { BANNER } from "./debug/banner";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

test("a Git error shows as a banner under its source and closes with its cross", async () => {
  const repo = resolve("/repo/banner");
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      options.actions.setLoading(false);
      options.actions.setError(BANNER.git.unreachable);
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
      { width: 110, height: 40 },
    );
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("Remote unreachable · Git"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(lines[y].indexOf("✕"), y);
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Remote unreachable");
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});
