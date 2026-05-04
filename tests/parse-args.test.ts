/**
 * Test: verifies parseArgs — CLI argument parsing logic.
 *
 * Covers: positional repo path, help/version, unknown flags.
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
  test("no arguments yields cwd repo path", () => {
    const opts = parseArgs([...ARGV_PREFIX]);
    expect(opts.repoPath).toBe(process.cwd());
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

  test("removed startup flags now error", () => {
    for (const flag of ["--branch", "-b", "--max-count", "-n", "--theme", "--path", "--no-all"]) {
      expect(() => parseArgs([...ARGV_PREFIX, flag])).toThrow("process.exit");
      expect(lastExitCode).toBe(1);
      lastExitCode = undefined;
    }
  });
});
