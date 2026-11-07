import { describe, expect, test } from "bun:test";
import { snykFailureReason } from "../src/providers/snyk/failure-reason";

describe("snykFailureReason", () => {
  test("joins Snyk's lines into one sentence without worktree paths or debug hints", () => {
    expect(
      snykFailureReason(
        ["  Could not find /tmp/scan/worktree/web/yarn.lock.", "  Run with `-d` for debug output."],
        ["/tmp/scan/worktree"],
      ),
    ).toBe("Could not find web/yarn.lock.");
  });

  test("replaces advice that doesn't fit a clean checkout", () => {
    expect(
      snykFailureReason(
        ["  Missing node_modules folder: we can't test without dependencies.", "Please run 'npm install' first."],
        [],
      ),
    ).toBe("Missing node_modules folder. Snyk needs a lockfile for this project, since scans run on a clean checkout.");
  });

  test("shortens long build output", () => {
    const reason = snykFailureReason([`[ERROR] ${"x".repeat(400)}`], []);
    expect(reason?.length).toBe(240);
    expect(reason?.endsWith("…")).toBe(true);
  });

  test("is null when nothing readable is left", () => {
    expect(snykFailureReason([], [])).toBeNull();
    expect(snykFailureReason(["  ---  "], [])).toBeNull();
    expect(snykFailureReason(["Run with -d for debug output."], [])).toBeNull();
  });
});
