/**
 * Test: verifies parseArgs — CLI argument parsing logic.
 *
 * Covers: positional repo path, help/version, unknown flags.
 *
 * Note: --help, --version, and error paths call process.exit().
 * We mock process.exit to capture exit codes without terminating the test runner.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { parseArgs } from "../src/cli/parse-args";

/** Fake argv prefix: parseArgs slices from index 2. */
const ARGV_PREFIX = ["node", "codepulse"];

/** Save original process.exit so we can restore it. */
const originalExit = process.exit;

let lastExitCode: number | undefined;

function expectParseArgsExit(argv: string[], code: number): void {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(() => parseArgs(argv)).toThrow("process.exit");
    expect(lastExitCode).toBe(code);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}

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
    expectParseArgsExit([...ARGV_PREFIX, "--help"], 0);
  });

  test("-h exits with code 0", () => {
    expectParseArgsExit([...ARGV_PREFIX, "-h"], 0);
  });

  test("--version exits with code 0", () => {
    expectParseArgsExit([...ARGV_PREFIX, "--version"], 0);
  });

  test("-v exits with code 0", () => {
    expectParseArgsExit([...ARGV_PREFIX, "-v"], 0);
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
    expectParseArgsExit([...ARGV_PREFIX, "--unknown"], 1);
  });

  test("removed startup flags now error", () => {
    for (const flag of ["--branch", "-b", "--max-count", "-n", "--theme", "--path", "--no-all"]) {
      expectParseArgsExit([...ARGV_PREFIX, flag], 1);
      lastExitCode = undefined;
    }
  });
});
