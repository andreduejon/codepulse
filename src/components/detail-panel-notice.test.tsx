import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { TabNotice } from "../app-tab-notice";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import DetailPanel from "./detail-panel";
import type { DetailNavRef } from "./detail-types";

const notice: TabNotice = {
  key: "snyk-deps:abc:now",
  fromStatus: false,
  kind: "warning",
  title: "1 project failed, 1 skipped",
  detail: [],
  entries: [
    { label: "apps/web/package.json", text: "Missing node_modules folder." },
    { label: "tools/legacy/package.json", text: "No lockfile." },
  ],
};

test("the tab notice is pinned under the tab content and closes with its cross", async () => {
  const theme = createThemeState();
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const [current, setCurrent] = createSignal<TabNotice | null>(notice);
  const dismiss = mock(() => setCurrent(null));
  const setup = await testRender(
    () => {
      const app = createAppState(100, 0, 0);
      app.actions.setLoading(false);
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <DetailPanel
              mouseEnabled
              navRef={navRef}
              searchFocused={false}
              onJumpToCommit={() => {}}
              onOpenDiff={() => {}}
              tabNotice={current()}
              onDismissTabNotice={dismiss}
            />
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 60, height: 30 },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("1 project failed, 1 skipped"));
    expect(y).toBeGreaterThan(0);
    expect(lines[y + 1]).toContain("apps/web/package.json");
    expect(lines[y + 2]).toContain("Missing node_modules folder.");
    expect(lines[y + 4]).toContain("No lockfile.");
    // Raised background so it stands out from the panel.
    const row = setup.captureSpans().lines[y];
    expect(row?.spans.some(span => span.bg.equals(RGBA.fromHex(theme.theme().backgroundElement)))).toBe(true);
    await setup.mockMouse.click(lines[y].indexOf("✕"), y);
    await setup.renderOnce();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(setup.captureCharFrame()).not.toContain("1 project failed");
  } finally {
    setup.renderer.destroy();
  }
});
