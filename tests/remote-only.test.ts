/**
 * Test: verifies remote-only branch dimming, propagation, and
 * remote prefix handling.
 *
 * Remote-only branches (remote branches with no local counterpart) should
 * have `isRemoteOnly=true` on their lanes, connectors, and rows. This flag
 * propagates through single-parent chains, merge first-parents, secondary
 * parent connectors, fan-out rows, and is also applied by the post-pass
 * dimming logic.
 *
 * Also covers: upstream/ remotes, nested paths (origin/renovate/major),
 * and multi-remote scenarios.
 */
import { describe, expect, test } from "bun:test";
import { buildGraph } from "../src/git/graph";
import { assertRowFullyDimmed, findConnector, makeCommit, printGraph } from "./test-helpers";

describe("Remote-Only", () => {
  test("Remote-only lane propagation (single parent)", () => {
    const commits = [
      makeCommit("f1", ["d1"], [{ name: "origin/feature-x", type: "remote", isCurrent: false }], "feature-x work"),
      makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isRemoteOnly).toBe(true);

    const f1Node = findConnector(rows[0].connectors, "node");
    expect(f1Node).toBeDefined();
    if (!f1Node) throw new Error("f1Node not found");
    expect(f1Node.isRemoteOnly).toBe(true);

    expect(rows[1].isRemoteOnly).toBeFalsy();

    const d1Node = findConnector(rows[1].connectors, "node");
    expect(d1Node).toBeDefined();
    if (!d1Node) throw new Error("d1Node not found");
    expect(d1Node.isRemoteOnly).not.toBe(true);
  });

  test("Remote-only propagation through merge first parent", () => {
    const commits = [
      makeCommit(
        "m1",
        ["f1", "x1"],
        [{ name: "origin/feature-y", type: "remote", isCurrent: false }],
        "merge in feature-y",
      ),
      makeCommit("f1", ["d1"], [], "feature-y work"),
      makeCommit("x1", ["d1"], [], "side branch work"),
      makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isRemoteOnly).toBe(true);
    expect(rows[1].isRemoteOnly).toBe(true);
    expect(rows[3].isRemoteOnly).toBeFalsy();
  });

  test("Remote-only merge connectors (secondary parent)", () => {
    const commits = [
      makeCommit("d3", ["m1"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
      makeCommit("m1", ["d2", "r1"], [], "Merge remote feature"),
      makeCommit(
        "r1",
        ["d1"],
        [{ name: "origin/remote-feat", type: "remote", isCurrent: false }],
        "remote feature work",
      ),
      makeCommit("d2", ["d1"], [], "develop work"),
      makeCommit("d1", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const mergeRow = rows[1];
    expect(mergeRow.commit.hash).toBe("m1");
    expect(mergeRow.isRemoteOnly).toBeFalsy();

    const spanTypes = new Set([
      "horizontal",
      "corner-top-right",
      "corner-top-left",
      "corner-bottom-right",
      "corner-bottom-left",
      "tee-left",
      "tee-right",
    ]);
    const spanConns = mergeRow.connectors.filter(c => spanTypes.has(c.type));
    expect(spanConns.length).toBeGreaterThan(0);
  });

  test("Fan-out remote-only flags", () => {
    const commits = [
      makeCommit("r1", ["d1"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a work"),
      makeCommit("r2", ["d1"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b work"),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
      makeCommit("d0", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const d1Row = rows.find(r => r.commit.hash === "d1");
    expect(d1Row).toBeDefined();
    if (!d1Row) throw new Error("d1Row not found");
    expect(d1Row.fanOutRows !== undefined && d1Row.fanOutRows.length > 0).toBe(true);

    if (d1Row.fanOutRows) {
      for (let foIdx = 0; foIdx < d1Row.fanOutRows.length; foIdx++) {
        const corners = d1Row.fanOutRows[foIdx].filter(
          c => c.type === "corner-bottom-right" || c.type === "corner-bottom-left",
        );
        for (const corner of corners) {
          expect(corner.isRemoteOnly).toBe(true);
        }
      }
    }

    expect(d1Row.isRemoteOnly).toBeFalsy();
  });

  test("Post-pass dimming includes fan-out rows", () => {
    const commits = [
      makeCommit(
        "ren1",
        ["d1"],
        [{ name: "origin/renovate/major", type: "remote", isCurrent: false }],
        "renovate major",
      ),
      makeCommit(
        "ren2",
        ["d1"],
        [{ name: "origin/renovate/minor", type: "remote", isCurrent: false }],
        "renovate minor",
      ),
      makeCommit(
        "ren3",
        ["d1"],
        [{ name: "origin/renovate/patch", type: "remote", isCurrent: false }],
        "renovate patch",
      ),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
      makeCommit("d0", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const firstNonRO = rows.findIndex(r => !r.isRemoteOnly);
    expect(firstNonRO).toBeGreaterThan(0);

    for (let i = 0; i < firstNonRO; i++) {
      assertRowFullyDimmed(rows[i], i);
    }

    const d1Row = rows[firstNonRO];
    expect(d1Row.commit.hash).toBe("d1");
    expect(d1Row.isRemoteOnly).toBeFalsy();
  });

  test("upstream/ remote-only when no local counterpart", () => {
    const commits = [
      makeCommit("f1", ["d1"], [{ name: "upstream/feature", type: "remote", isCurrent: false }]),
      makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isRemoteOnly).toBe(true);
    expect(rows[0].remoteOnlyBranches.has("upstream/feature")).toBe(true);
  });

  test("upstream/ remote not remote-only when local exists", () => {
    const commits = [
      makeCommit(
        "d1",
        [],
        [
          { name: "main", type: "branch", isCurrent: true },
          { name: "upstream/main", type: "remote", isCurrent: false },
        ],
      ),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isRemoteOnly).toBeFalsy();
    expect(rows[0].remoteOnlyBranches.has("upstream/main")).toBe(false);
  });

  test("origin/ and upstream/ on same commit, both tracked", () => {
    const commits = [
      makeCommit(
        "d1",
        [],
        [
          { name: "main", type: "branch", isCurrent: true },
          { name: "origin/main", type: "remote", isCurrent: false },
          { name: "upstream/main", type: "remote", isCurrent: false },
        ],
      ),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].remoteOnlyBranches.has("origin/main")).toBe(false);
    expect(rows[0].remoteOnlyBranches.has("upstream/main")).toBe(false);
    expect(rows[0].isRemoteOnly).toBeFalsy();
  });

  test("Nested remote path prefix stripping", () => {
    const commits = [
      makeCommit("r1", ["d1"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }]),
      makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].remoteOnlyBranches.has("origin/renovate/major")).toBe(true);
    expect(rows[0].isRemoteOnly).toBe(true);
  });

  test("Nested remote path with local equivalent", () => {
    const commits = [
      makeCommit(
        "r1",
        [],
        [
          { name: "renovate/major", type: "branch", isCurrent: false },
          { name: "origin/renovate/major", type: "remote", isCurrent: false },
          { name: "main", type: "branch", isCurrent: true },
        ],
      ),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].remoteOnlyBranches.has("origin/renovate/major")).toBe(false);
  });

  test("Multiple remotes same branch, both remote-only", () => {
    const commits = [
      makeCommit(
        "f1",
        ["d1"],
        [
          { name: "origin/feature", type: "remote", isCurrent: false },
          { name: "upstream/feature", type: "remote", isCurrent: false },
        ],
      ),
      makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].remoteOnlyBranches.has("origin/feature")).toBe(true);
    expect(rows[0].remoteOnlyBranches.has("upstream/feature")).toBe(true);
    expect(rows[0].isRemoteOnly).toBe(true);
  });
});
