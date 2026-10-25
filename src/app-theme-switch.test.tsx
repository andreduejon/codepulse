import { expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import { createThemeState } from "./context/theme";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";

test.each([
  ["no", undefined],
  ["an unknown", "removed-custom-theme"],
])(
  "switching repositories applies each repository's theme (%s theme falls back to the default)",
  async (_, secondTheme) => {
    const first = resolve("/repo/a-olive");
    const second = resolve("/repo/b-default");
    const themes: Record<string, string | undefined> = { [first]: "olive-garden", [second]: secondTheme };
    const backfill = spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {});
    const loadConfig = spyOn(config, "loadConfig").mockImplementation(path => ({
      config: themes[path] ? { theme: themes[path] } : {},
      warnings: [],
    }));
    const displayConfig = spyOn(config, "getRepoDisplayConfig").mockReturnValue({ group: "g" });
    const known = spyOn(config, "getKnownRepoInfos").mockReturnValue([
      { path: first, group: "g" },
      { path: second, group: "g" },
    ]);
    const detail = spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {});
    const title = spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {});
    const loader = spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    });
    const themeState = createThemeState("olive-garden");
    let setup: Awaited<ReturnType<typeof testRender>> | undefined;
    try {
      setup = await testRender(
        () => (
          <AppContent
            repoPath={first}
            startupMode={{ kind: "graph" }}
            themeState={themeState}
            autoRefreshInterval={0}
            autoFetchInterval={0}
          />
        ),
        { width: 110, height: 40, kittyKeyboard: true },
      );
      await setup.flush();
      expect(themeState.themeName()).toBe("olive-garden");
      setup.mockInput.pressKey("ARROW_RIGHT", { shift: true });
      await setup.flush();
      expect(themeState.themeName()).toBe(config.defaultConfig().theme);
      setup.mockInput.pressKey("ARROW_LEFT", { shift: true });
      await setup.flush();
      expect(themeState.themeName()).toBe("olive-garden");
    } finally {
      await setup?.dispose();
      for (const spy of [backfill, loadConfig, displayConfig, known, detail, title, loader]) spy.mockRestore();
    }
  },
);
