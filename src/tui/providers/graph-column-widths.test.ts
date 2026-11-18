import { describe, expect, test } from "bun:test";
import { aggregateRunsToGraphBadge } from "../../core/github/commit-data";
import type { GitHubWorkflowRun } from "../../core/github/types";
import type { GraphBadge } from "../../core/provider-model";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH } from "../constants";
import { GIT_WIDTHS } from "./graph-column-widths";
import { OPENSHIFT_GRAPH_COLUMNS } from "./openshift/graph-columns";
import { CI_GRAPH_COLUMNS } from "./shared/ci-columns";
import { chipsWidth, statusCountChipsWidth } from "./shared/status-chips";

const badge = (overrides: Partial<GraphBadge>): GraphBadge => ({
  sha: "a",
  badge: "pass",
  passCount: 0,
  failCount: 0,
  runningCount: 0,
  latestRunAt: "",
  latestStatus: "pass",
  ...overrides,
});

describe("status chips", () => {
  test("measure ` n ` per chip with one column between chips", () => {
    expect(chipsWidth(["1", "12"])).toBe(3 + 4 + 1);
    expect(statusCountChipsWidth({ failCount: 1, runningCount: 2, unknownCount: 3, passCount: 40 })).toBe(
      3 + 3 + 3 + 4 + 3,
    );
    expect(statusCountChipsWidth(undefined)).toBe(0);
  });
});

describe("provider column widths", () => {
  test("Git and small CI counts keep the Author and Date widths", () => {
    expect(GIT_WIDTHS).toEqual({ first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH });
    const small = new Map([["a", badge({ passCount: 3 })]]);
    expect(CI_GRAPH_COLUMNS.widths(small)).toEqual({ first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH });
  });

  test("CI columns grow to fit every chip instead of clipping the last one", () => {
    const wide = new Map([["a", badge({ failCount: 12, runningCount: 10, unknownCount: 11, passCount: 140 })]]);
    // ` 12 ` ` 10 ` ` 11 ` ` 140 ` + 3 gaps + 2 padding
    expect(CI_GRAPH_COLUMNS.widths(wide).first).toBe(4 + 4 + 4 + 5 + 3 + 2);
  });

  test("OpenShift Resources fits four single-digit chips (15 + padding), and the muted cached count after", () => {
    const lanes = { live: { failCount: 1, runningCount: 1, unknownCount: 1, passCount: 1 } };
    expect(OPENSHIFT_GRAPH_COLUMNS.widths(new Map([["a", badge({ lanes })]])).first).toBe(15 + 2);
    // Four ` 1 ` chips (15), a gap and ` 12 `, then the padding.
    const cached = OPENSHIFT_GRAPH_COLUMNS.widths(new Map([["a", badge({ lanes, cachedCount: 12 })]]));
    expect(cached.first).toBe(15 + 1 + 4 + 2);
  });

  test("OpenShift Events fits the warning count and the muted cached one", () => {
    const widths = OPENSHIFT_GRAPH_COLUMNS.widths(
      new Map([["a", badge({ warningCount: 120, cachedWarningCount: 3400 })]]),
    );
    // ` 120 ` (5), a gap, ` 3400 ` (6): wider than the Date column.
    expect(widths.second).toBe(Math.max(DATE_COL_WIDTH, 5 + 1 + 6));
  });
});

describe("GitHub badges", () => {
  test("cancelled and skipped runs count as neutral instead of disappearing", () => {
    const run = (conclusion: string): GitHubWorkflowRun =>
      ({
        id: 1,
        name: "CI",
        status: "completed",
        conclusion,
        headSha: "a",
        runNumber: 1,
        updatedAt: "2026-01-01T00:00:00Z",
      }) as GitHubWorkflowRun;
    const result = aggregateRunsToGraphBadge("a", [run("cancelled"), run("skipped"), run("success")]);
    expect(result.unknownCount).toBe(2);
    expect(result.passCount).toBe(1);
  });
});
