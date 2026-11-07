import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import { createThemeState } from "./context/theme";
import { BANNER } from "./debug/banner";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";
import * as snykHook from "./providers/snyk/use-snyk";

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

test("Git view: a running Snyk scan shows in the footer, a failed one as an error banner that closes", async () => {
  const repo = resolve("/repo/banner");
  const [error, setError] = createSignal<string | null>(null);
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
    spyOn(snykHook, "useSnyk").mockImplementation(options => {
      options.state.providers.register({
        id: "snyk",
        displayName: "Snyk",
        isAvailable: () => true,
        activity: () => "scanning",
      });
      return {
        getCommitData: () => null,
        isScanning: () => false,
        scanCommit: async () => null,
        isAvailable: () => true,
        invalidate: () => {},
        backgroundError: error,
        dismissBackgroundError: () => setError(null),
      };
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
    expect(setup.captureCharFrame()).toContain("Snyk scanning");
    setError("Snyk could not resolve any project.\nrequirements.txt: Something went wrong getting dependencies");
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("Could not resolve any project · Snyk"));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(lines[y + 1]).toContain("requirements.txt: Something went wrong getting dependencies");
    await setup.mockMouse.click(lines[y].indexOf("✕"), y);
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Could not resolve any project");
    // Closing the banner leaves the running scan's footer hint alone.
    expect(setup.captureCharFrame()).toContain("Snyk scanning");
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});
