/** The graph mounts only the rows near the screen; the rows' computed heights match what they draw. */
import { expect, test } from "bun:test";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createComponent } from "solid-js";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import type { Commit } from "../core/git/types";
import { buildGraph, getMaxGraphColumns } from "../git/graph";
import GraphView, { graphRowHeight } from "./graph";

const hash = (name: string) => name.padStart(40, "0");

const makeCommit = (id: string, parents: string[], subject = `commit ${id}`): Commit => ({
  hash: id,
  shortHash: id.slice(-7),
  parents,
  subject,
  body: "",
  author: "Author",
  authorEmail: "author@example.com",
  authorDate: "2026-01-01T00:00:00Z",
  committer: "Author",
  committerEmail: "author@example.com",
  commitDate: "2026-01-01T00:00:00Z",
  refs: [],
});

/** A straight line of commits. */
const line = (count: number): Commit[] =>
  Array.from({ length: count }, (_, index) =>
    makeCommit(hash(`a${index}`), index < count - 1 ? [hash(`a${index + 1}`)] : [], `Commit ${index}`),
  );

/** Merges, branches off one commit (fan-out) and lanes beside each other: rows of every height. */
const branchy = (): Commit[] => {
  const commits: Commit[] = [];
  for (let block = 0; block < 6; block++) {
    const base = hash(`b${block + 1}`);
    commits.push(makeCommit(hash(`m${block}`), [hash(`x${block}`), hash(`y${block}`)], `Merge ${block}`));
    commits.push(makeCommit(hash(`x${block}`), [base]));
    commits.push(makeCommit(hash(`y${block}`), [hash(`z${block}`)]));
    commits.push(makeCommit(hash(`z${block}`), [base]));
    commits.push(makeCommit(hash(`w${block}`), [base]));
    commits.push(makeCommit(hash(`b${block}`), [base]));
  }
  commits.push(makeCommit(hash("b6"), []));
  return commits;
};

async function mount(height = 40) {
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
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
              return createComponent(GraphView, { scrollboxRef: element => (scrollbox = element) });
            },
          });
        },
      });
    },
    { width: 160, height },
  );
  const show = async (commits: Commit[]) => {
    const rows = buildGraph(commits);
    app.actions.setGraphRows(rows);
    app.actions.setMaxGraphColumns(getMaxGraphColumns(rows));
    await setup.renderOnce();
    return rows;
  };
  return { app, setup, show, scrollbox: () => scrollbox };
}

const count = (node: Renderable): number => 1 + node.getChildren().reduce((sum, child) => sum + count(child), 0);

test("the graph mounts the rows near the screen, not all of them, and the cursor brings the next ones", async () => {
  const { app, setup, show } = await mount();
  try {
    await show(line(100));
    const hundred = count(setup.renderer.root);
    await show(line(2_000));
    expect(count(setup.renderer.root)).toBeLessThan(hundred * 2);
    app.actions.moveCursor(1_999);
    for (let frame = 0; frame < 5; frame++) await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Commit 1999");
    expect(setup.captureCharFrame()).not.toContain("Commit 0 ");
  } finally {
    setup.renderer.destroy();
  }
});

test("each row is as tall as its computed height", async () => {
  // Shorter than the graph, so the scrollbox is as tall as its content; all rows still mount (the overscan).
  const { setup, show, scrollbox } = await mount(20);
  try {
    const rows = await show(branchy());
    expect(rows.some(row => (row.fanOutRows?.length ?? 0) > 0)).toBe(true);
    const total = rows.reduce((sum, row, index) => sum + graphRowHeight(row, index === rows.length - 1), 0);
    await setup.renderOnce();
    expect(scrollbox().scrollHeight).toBe(total);
  } finally {
    setup.renderer.destroy();
  }
});
