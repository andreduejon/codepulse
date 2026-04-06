/**
 * Test: verifies buildCommitLogArgs — the pure arg-building logic extracted
 * from getCommits in repo.ts.
 *
 * Covers: --skip, --max-count defaults, --all with stash exclusion,
 * branch + "--" disambiguation, and option interactions.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_COUNT } from "../src/constants";
import { buildCommitLogArgs, RS } from "../src/git/repo";

/**
 * The expected --format value (mirrors GIT_LOG_FORMAT which is private).
 * We derive it from the RS constant so the test stays in sync.
 */
const EXPECTED_FORMAT = `%H${RS}%h${RS}%P${RS}%D${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

describe("buildCommitLogArgs", () => {
  // ── Baseline ──────────────────────────────────────────────────────

  test("default options produce log + topo-order + format + default max-count", () => {
    const args = buildCommitLogArgs({});
    expect(args).toEqual(["log", "--topo-order", `--format=${EXPECTED_FORMAT}`, `--max-count=${DEFAULT_MAX_COUNT}`]);
  });

  // ── maxCount ──────────────────────────────────────────────────────

  test("custom maxCount overrides DEFAULT_MAX_COUNT", () => {
    const args = buildCommitLogArgs({ maxCount: 50 });
    expect(args).toContain("--max-count=50");
    expect(args).not.toContain(`--max-count=${DEFAULT_MAX_COUNT}`);
  });

  test("maxCount of 1 is respected", () => {
    const args = buildCommitLogArgs({ maxCount: 1 });
    expect(args).toContain("--max-count=1");
  });

  // ── skip ──────────────────────────────────────────────────────────

  test("skip > 0 adds --skip argument", () => {
    const args = buildCommitLogArgs({ skip: 200 });
    expect(args).toContain("--skip=200");
  });

  test("skip = 0 does NOT add --skip argument", () => {
    const args = buildCommitLogArgs({ skip: 0 });
    const skipArgs = args.filter(a => a.startsWith("--skip"));
    expect(skipArgs.length).toBe(0);
  });

  test("skip undefined does NOT add --skip argument", () => {
    const args = buildCommitLogArgs({});
    const skipArgs = args.filter(a => a.startsWith("--skip"));
    expect(skipArgs.length).toBe(0);
  });

  test("negative skip does NOT add --skip argument", () => {
    const args = buildCommitLogArgs({ skip: -5 });
    const skipArgs = args.filter(a => a.startsWith("--skip"));
    expect(skipArgs.length).toBe(0);
  });

  // ── all ───────────────────────────────────────────────────────────

  test("all=true adds stash exclusion BEFORE --all", () => {
    const args = buildCommitLogArgs({ all: true });
    const excludeIdx = args.indexOf("--exclude=refs/stash*");
    const allIdx = args.indexOf("--all");
    expect(excludeIdx).toBeGreaterThan(-1);
    expect(allIdx).toBeGreaterThan(-1);
    // --exclude must appear before --all for git to apply it correctly
    expect(excludeIdx).toBeLessThan(allIdx);
  });

  test("all=false does NOT add --all or --exclude", () => {
    const args = buildCommitLogArgs({ all: false });
    expect(args).not.toContain("--all");
    expect(args).not.toContain("--exclude=refs/stash*");
  });

  // ── branch ────────────────────────────────────────────────────────

  test("branch adds branch name followed by '--' for disambiguation", () => {
    const args = buildCommitLogArgs({ branch: "feature/foo" });
    const branchIdx = args.indexOf("feature/foo");
    const dashIdx = args.indexOf("--");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(dashIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeLessThan(dashIdx);
  });

  test("branch does NOT add --all or --exclude", () => {
    const args = buildCommitLogArgs({ branch: "main" });
    expect(args).not.toContain("--all");
    expect(args).not.toContain("--exclude=refs/stash*");
  });

  // ── all + branch interaction ──────────────────────────────────────

  test("all=true takes precedence over branch (branch is ignored)", () => {
    // In the code, `if (options.all)` is checked first, `else if (options.branch)`.
    const args = buildCommitLogArgs({ all: true, branch: "main" });
    expect(args).toContain("--all");
    expect(args).not.toContain("main");
    expect(args).not.toContain("--");
  });

  // ── combined options ──────────────────────────────────────────────

  test("skip + maxCount + all produces correct full args", () => {
    const args = buildCommitLogArgs({ maxCount: 100, skip: 300, all: true });
    expect(args).toEqual([
      "log",
      "--topo-order",
      `--format=${EXPECTED_FORMAT}`,
      "--max-count=100",
      "--skip=300",
      "--exclude=refs/stash*",
      "--all",
    ]);
  });

  test("skip + maxCount + branch produces correct full args", () => {
    const args = buildCommitLogArgs({ maxCount: 50, skip: 100, branch: "develop" });
    expect(args).toEqual([
      "log",
      "--topo-order",
      `--format=${EXPECTED_FORMAT}`,
      "--max-count=50",
      "--skip=100",
      "develop",
      "--",
    ]);
  });
});
