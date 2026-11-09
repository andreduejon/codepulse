import { expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender, useKeyboard } from "@opentui/solid";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import { buildGraph } from "../git/graph";
import type { CommitDetail } from "../git/types";
import { handleDetailKey } from "../hooks/handle-detail-keys";
import DetailPanel from "./detail-panel";
import type { DetailNavRef } from "./detail-types";

test("a commit body taller than the panel scrolls with ↓ before the cursor moves past it", async () => {
  const body = Array.from({ length: 60 }, (_, index) => `body line ${index + 1}`).join("\n");
  const detail: CommitDetail = {
    hash: "abc123456789",
    shortHash: "abc1234",
    parents: [],
    subject: "Long body fixture",
    body,
    author: "Alice",
    authorEmail: "alice@example.com",
    authorDate: "2026-10-01T12:00:00Z",
    committer: "Alice",
    committerEmail: "alice@example.com",
    commitDate: "2026-10-01T12:00:00Z",
    refs: [],
    files: [],
  };
  const navRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
    itemRefs: [],
  };
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setCommits([detail]);
      app.actions.setGraphRows(buildGraph([detail]));
      app.actions.setCommitDetail(detail);
      app.actions.setDetailActiveTab("info");
      app.actions.setDetailFocused(true);
      useKeyboard(event =>
        handleDetailKey(event, {
          ...app,
          dialog: () => null,
          getDetailScrollboxRef: () => scrollbox,
          detailNavRef: navRef,
        }),
      );
      return (
        <ThemeContext.Provider value={createThemeState()}>
          <AppStateContext.Provider value={app}>
            <box width={62} height={20} flexDirection="column">
              <DetailPanel
                navRef={navRef}
                searchFocused={false}
                onOpenDiff={() => {}}
                onJumpToCommit={() => {}}
                scrollboxRef={el => (scrollbox = el)}
              />
            </box>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 80, height: 24, kittyKeyboard: true },
  );
  const flush = async () => {
    await setup.flush({ maxPasses: 20 });
    await Bun.sleep(15);
    await setup.flush({ maxPasses: 20 });
  };
  try {
    await flush();
    // Walk down until the body is the cursored item, then keep pressing ↓: every body line must come into view.
    const seen = new Set<string>();
    for (let press = 0; press < 90; press++) {
      for (const line of setup.captureCharFrame().split("\n")) {
        const match = /body line (\d+)/.exec(line);
        if (match) seen.add(match[1]);
      }
      setup.mockInput.pressKey("ARROW_DOWN");
      await flush();
    }
    for (let line = 1; line <= 60; line++) expect(seen.has(String(line))).toBe(true);
  } finally {
    await setup.dispose();
  }
});
