/**
 * Test: verifies graph behavior with the uncommitted-changes synthetic node.
 *
 * Stash commits are no longer injected into the graph — they appear as
 * badges on parent commits and in the detail panel's stash section.
 * The uncommitted node is the only synthetic commit in the commit list.
 */
import { describe, test, expect } from "bun:test";
import { buildGraph } from "../src/git/graph";
import { makeCommit, printGraph } from "./test-helpers";

describe("Uncommitted Changes Node", () => {
  test("uncommitted on lane 0 as continuation of current branch", () => {
    const commits = [
      makeCommit("uc", ["tip"], [{ name: "uncommitted", type: "uncommitted", isCurrent: false }], "Uncommitted changes"),
      makeCommit("tip", ["base"], [{ name: "main", type: "branch", isCurrent: true }], "tip"),
      makeCommit("base", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const ucRow = rows.find(r => r.commit.hash === "uc")!;
    const tipRow = rows.find(r => r.commit.hash === "tip")!;

    // Uncommitted is on lane 0 — continuation of current branch
    expect(ucRow.nodeColumn).toBe(0);
    // Tip also on lane 0
    expect(tipRow.nodeColumn).toBe(0);
    // No fan-out needed (uncommitted is on the same lane)
    expect(tipRow.fanOutRows).toBeUndefined();
  });

  test("uncommitted with side branches stays on lane 0", () => {
    const commits = [
      makeCommit("uc", ["tip"], [{ name: "uncommitted", type: "uncommitted", isCurrent: false }], "Uncommitted changes"),
      makeCommit("feat", ["base"], [{ name: "feature", type: "branch", isCurrent: false }], "feature tip"),
      makeCommit("tip", ["base"], [{ name: "main", type: "branch", isCurrent: true }], "tip"),
      makeCommit("base", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const ucRow = rows.find(r => r.commit.hash === "uc")!;
    // Uncommitted is on lane 0
    expect(ucRow.nodeColumn).toBe(0);
  });
});

describe("Stash Badge on Parent Commits", () => {
  test("stash badge ref does not create graph lanes", () => {
    // Parent commit has a stash badge ref — but no stash commit in the list.
    // The graph should be a simple straight line.
    const commits = [
      makeCommit("tip", ["base"], [
        { name: "main", type: "branch", isCurrent: true },
        { name: "stash (2)", type: "stash", isCurrent: false },
      ], "tip with stashes"),
      makeCommit("base", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    // Simple 2-commit straight line, both on lane 0
    expect(rows[0].nodeColumn).toBe(0);
    expect(rows[1].nodeColumn).toBe(0);
    // No fan-out — stash badge is just a ref, not a child commit
    expect(rows[0].fanOutRows).toBeUndefined();
    // Stash ref should be present on the commit
    const stashRef = rows[0].commit.refs.find(r => r.type === "stash");
    expect(stashRef).toBeDefined();
    expect(stashRef!.name).toBe("stash (2)");
  });

  test("uncommitted + stash badge coexist without conflict", () => {
    const commits = [
      makeCommit("uc", ["tip"], [{ name: "uncommitted", type: "uncommitted", isCurrent: false }], "Uncommitted changes"),
      makeCommit("tip", ["base"], [
        { name: "main", type: "branch", isCurrent: true },
        { name: "stash (1)", type: "stash", isCurrent: false },
      ], "tip with stash"),
      makeCommit("base", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    // Uncommitted on lane 0
    expect(rows.find(r => r.commit.hash === "uc")!.nodeColumn).toBe(0);
    // Tip on lane 0
    expect(rows.find(r => r.commit.hash === "tip")!.nodeColumn).toBe(0);
    // Stash ref on tip
    const tipRefs = rows.find(r => r.commit.hash === "tip")!.commit.refs;
    expect(tipRefs.some(r => r.type === "stash")).toBe(true);
  });
});
