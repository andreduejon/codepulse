import { describe, expect, test } from "bun:test";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH } from "../constants";
import { aggregateRunsToGraphBadge } from "./github-actions/api";
import type { GitHubWorkflowRun } from "./github-actions/types";
import { graphColumnWidths } from "./graph-column-widths";
import type { GraphBadge } from "./provider";
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

describe("graphColumnWidths", () => {
  test("Git and small CI counts keep the Author and Date widths", () => {
    expect(graphColumnWidths("git", new Map())).toEqual({ first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH });
    const small = new Map([["a", badge({ passCount: 3 })]]);
    expect(graphColumnWidths("github-actions", small)).toEqual({ first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH });
  });

  test("CI columns grow to fit every chip instead of clipping the last one", () => {
    const wide = new Map([["a", badge({ failCount: 12, runningCount: 10, unknownCount: 11, passCount: 140 })]]);
    // ` 12 ` ` 10 ` ` 11 ` ` 140 ` + 3 gaps + 2 padding
    expect(graphColumnWidths("jenkins", wide).first).toBe(4 + 4 + 4 + 5 + 3 + 2);
  });

  test("OpenShift Live fits four single-digit chips (15 + padding)", () => {
    const lanes = {
      live: { failCount: 1, runningCount: 1, unknownCount: 1, passCount: 1 },
      cache: { failCount: 0, runningCount: 0, unknownCount: 0, passCount: 2 },
    };
    const widths = graphColumnWidths("openshift", new Map([["a", badge({ lanes })]]));
    expect(widths.first).toBe(15 + 2);
    expect(widths.second).toBe(DATE_COL_WIDTH);
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
