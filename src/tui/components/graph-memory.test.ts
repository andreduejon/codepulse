import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createComponent } from "solid-js";
import { buildGraph } from "../../core/git/graph";
import type { Commit } from "../../core/git/types";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import GraphView from "./graph";

const commits = (count: number): Commit[] =>
  Array.from({ length: count }, (_, index) => ({
    hash: String(index).padStart(40, "0"),
    shortHash: String(index),
    parents: index < count - 1 ? [String(index + 1).padStart(40, "0")] : [],
    subject: `Commit ${index}`,
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-01-01T00:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-01-01T00:00:00Z",
    refs: [],
  }));

/** The JavaScript heap after a full collection, in MB. */
const heap = () => {
  Bun.gc(true);
  return heapStats().heapSize / 2 ** 20;
};

test("the graph lets go of the rows it no longer shows when it gets shorter", async () => {
  let app!: ReturnType<typeof createAppState>;
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setLoading(false);
      app.actions.setHasMore(false);
      return createComponent(ThemeContext.Provider, {
        value: createThemeState(),
        get children() {
          return createComponent(AppStateContext.Provider, {
            value: app,
            get children() {
              return createComponent(GraphView, {});
            },
          });
        },
      });
    },
    { width: 160, height: 40 },
  );
  try {
    // Once around first: what rendering many rows costs once (compiled code, caches) is not kept rows.
    const shown = async (count: number) => {
      app.actions.setGraphRows(buildGraph(commits(count)));
      await setup.renderOnce();
    };
    await shown(2_000);
    await shown(10);
    const before = heap();
    // 4,000 rows (pages of history), then a short graph again (a branch filter, another repository).
    await shown(4_000);
    await shown(10);
    // Kept rows: about 30 MB. What stays besides them (the heap grown for 4,000 rows) is about 5 MB.
    expect(heap() - before).toBeLessThan(12);
  } finally {
    setup.renderer.destroy();
  }
});
