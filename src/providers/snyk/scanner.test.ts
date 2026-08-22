import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnykCache } from "./cache";
import { type SnykCommandRunner, scanSnykCommit } from "./scanner";
import type { SnykScanResult } from "./types";

const SHA = "a".repeat(40);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "codepulse-snyk-scanner-test-"));
  roots.push(path);
  return path;
}

describe("scanSnykCommit", () => {
  test("scans a detached worktree and caches exit 1 results", async () => {
    const cacheRoot = await root();
    const commands: { command: string[]; cwd: string; hasSignal: boolean }[] = [];
    const runner: SnykCommandRunner = async (command, options) => {
      commands.push({ command, cwd: options.cwd, hasSignal: !!options.signal });
      if (command[1] === "rev-parse") return { stdout: `${SHA}\n`, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify({
            vulnerabilities: [{ id: "SNYK-1", severity: "high", packageName: "dep", version: "1.0.0" }],
          }),
          exitCode: 1,
        };
      }
      return { stdout: "", exitCode: 0 };
    };
    const controller = new AbortController();

    const result = await scanSnykCommit(
      { repoPath: "/repo", sha: SHA.slice(0, 8), signal: controller.signal },
      { cacheRoot, runCommand: runner, now: () => new Date("2026-08-21T10:00:00.000Z") },
    );

    expect(result.sha).toBe(SHA);
    expect(result.counts.high).toBe(1);
    expect(commands.find(call => call.command[0] === "snyk")?.command).toEqual([
      "snyk",
      "test",
      "--json",
      "--all-projects",
    ]);
    expect(commands.find(call => call.command[0] === "snyk")?.cwd).toContain("codepulse-snyk-");
    expect(commands.some(call => call.command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
    expect(await new SnykCache({ root: cacheRoot }).read("/repo", SHA)).toEqual(result);
  });

  test("cleans up and preserves an old cache entry when Snyk exits 2", async () => {
    const cacheRoot = await root();
    const cache = new SnykCache({ root: cacheRoot });
    const old: SnykScanResult = {
      sha: SHA,
      scannedAt: "2026-08-20T10:00:00.000Z",
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
    };
    await cache.write("/repo", old);
    const commands: string[][] = [];
    const runner: SnykCommandRunner = async command => {
      commands.push(command);
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") return { stdout: "sensitive raw output", exitCode: 2 };
      return { stdout: "", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, force: true }, { cacheRoot, runCommand: runner }),
    ).rejects.toThrow("exit code 2");
    expect(commands.some(command => command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
    expect(await cache.read("/repo", SHA)).toEqual(old);
  });

  test("aborts an active scan and still removes the worktree", async () => {
    const cacheRoot = await root();
    const controller = new AbortController();
    const commands: string[][] = [];
    const runner: SnykCommandRunner = async command => {
      commands.push(command);
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") controller.abort();
      return { stdout: "{}", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, signal: controller.signal }, { cacheRoot, runCommand: runner }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(commands.some(command => command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
  });
});
