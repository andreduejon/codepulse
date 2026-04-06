/**
 * Test: verifies parseArgs — CLI argument parsing logic.
 *
 * Covers: --branch/-b, --max-count/-n, --theme, --no-all, positional repo path,
 * default values, error cases, and flag interactions.
 *
 * Note: --help, --version, and error paths call process.exit().
 * We mock process.exit to capture exit codes without terminating the test runner.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/parse-args";

/** Fake argv prefix: parseArgs slices from index 2. */
const ARGV_PREFIX = ["node", "codepulse"];

/** Save original process.exit so we can restore it. */
const originalExit = process.exit;

let lastExitCode: number | undefined;

beforeEach(() => {
  lastExitCode = undefined;
  // Mock process.exit to throw instead of terminating
  process.exit = ((code?: number) => {
    lastExitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("parseArgs", () => {
  // ── Defaults ──────────────────────────────────────────────────────

  test("no arguments yields defaults (cwd, no branch, no all, no maxCount, no theme)", () => {
    const opts = parseArgs([...ARGV_PREFIX]);
    expect(opts.repoPath).toBe(process.cwd());
    expect(opts.branch).toBeUndefined();
    expect(opts.all).toBeUndefined();
    expect(opts.maxCount).toBeUndefined();
    expect(opts.themeName).toBeUndefined();
  });

  // ── --branch / -b ─────────────────────────────────────────────────

  test("--branch sets branch and forces all=false", () => {
    const opts = parseArgs([...ARGV_PREFIX, "--branch", "main"]);
    expect(opts.branch).toBe("main");
    expect(opts.all).toBe(false);
  });

  test("-b is shorthand for --branch", () => {
    const opts = parseArgs([...ARGV_PREFIX, "-b", "feature/foo"]);
    expect(opts.branch).toBe("feature/foo");
    expect(opts.all).toBe(false);
  });

  test("--branch without value exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--branch"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  // ── --max-count / -n ──────────────────────────────────────────────

  test("--max-count sets maxCount", () => {
    const opts = parseArgs([...ARGV_PREFIX, "--max-count", "500"]);
    expect(opts.maxCount).toBe(500);
  });

  test("-n is shorthand for --max-count", () => {
    const opts = parseArgs([...ARGV_PREFIX, "-n", "100"]);
    expect(opts.maxCount).toBe(100);
  });

  test("--max-count without value exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--max-count"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  test("--max-count with non-integer exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--max-count", "abc"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  test("--max-count with 0 exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--max-count", "0"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  test("--max-count with negative number exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--max-count", "-5"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  // ── --theme ───────────────────────────────────────────────────────

  test("--theme sets themeName", () => {
    const opts = parseArgs([...ARGV_PREFIX, "--theme", "gruvbox"]);
    expect(opts.themeName).toBe("gruvbox");
  });

  test("--theme without value exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--theme"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  // ── --no-all ──────────────────────────────────────────────────────

  test("--no-all sets all=false", () => {
    const opts = parseArgs([...ARGV_PREFIX, "--no-all"]);
    expect(opts.all).toBe(false);
  });

  // ── --help / --version ────────────────────────────────────────────

  test("--help exits with code 0", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--help"])).toThrow("process.exit");
    expect(lastExitCode).toBe(0);
  });

  test("-h exits with code 0", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "-h"])).toThrow("process.exit");
    expect(lastExitCode).toBe(0);
  });

  test("--version exits with code 0", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--version"])).toThrow("process.exit");
    expect(lastExitCode).toBe(0);
  });

  test("-v exits with code 0", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "-v"])).toThrow("process.exit");
    expect(lastExitCode).toBe(0);
  });

  // ── Positional repo path ──────────────────────────────────────────

  test("positional absolute path sets repoPath", () => {
    const opts = parseArgs([...ARGV_PREFIX, "/tmp/my-repo"]);
    expect(opts.repoPath).toBe("/tmp/my-repo");
  });

  test("positional relative path is resolved against cwd", () => {
    const opts = parseArgs([...ARGV_PREFIX, "my-repo"]);
    expect(opts.repoPath).toBe(`${process.cwd()}/my-repo`);
  });

  // ── Unknown flags ─────────────────────────────────────────────────

  test("unknown flag exits with code 1", () => {
    expect(() => parseArgs([...ARGV_PREFIX, "--unknown"])).toThrow("process.exit");
    expect(lastExitCode).toBe(1);
  });

  // ── Combined options ──────────────────────────────────────────────

  test("multiple options together", () => {
    const opts = parseArgs([...ARGV_PREFIX, "-b", "develop", "-n", "50", "--theme", "catppuccin", "/my/repo"]);
    expect(opts.branch).toBe("develop");
    expect(opts.all).toBe(false);
    expect(opts.maxCount).toBe(50);
    expect(opts.themeName).toBe("catppuccin");
    expect(opts.repoPath).toBe("/my/repo");
  });
});
