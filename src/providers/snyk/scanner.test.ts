import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

async function runLocal(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("scanSnykCommit", () => {
  test("scans an exact commit with real git and a PATH-resolved Snyk executable", async () => {
    const testRoot = await root();
    const repoPath = join(testRoot, "repo");
    const binPath = join(testRoot, "bin");
    const cacheRoot = join(testRoot, "cache");
    const capturePath = join(testRoot, "snyk-capture.txt");
    await Promise.all([mkdir(repoPath), mkdir(binPath)]);

    await runLocal(["git", "init"], repoPath);
    await runLocal(["git", "config", "user.name", "Scanner Test"], repoPath);
    await runLocal(["git", "config", "user.email", "scanner@example.test"], repoPath);
    await writeFile(join(repoPath, "marker.txt"), "target commit\n");
    await runLocal(["git", "add", "marker.txt"], repoPath);
    await runLocal(["git", "commit", "-m", "target"], repoPath);
    const targetSha = await runLocal(["git", "rev-parse", "HEAD"], repoPath);
    await writeFile(join(repoPath, "marker.txt"), "current checkout\n");
    await runLocal(["git", "commit", "-am", "current"], repoPath);

    const checkoutBefore = {
      sha: await runLocal(["git", "rev-parse", "HEAD"], repoPath),
      branch: await runLocal(["git", "branch", "--show-current"], repoPath),
      status: await runLocal(["git", "status", "--porcelain"], repoPath),
      marker: await readFile(join(repoPath, "marker.txt"), "utf8"),
      worktrees: await runLocal(["git", "worktree", "list", "--porcelain"], repoPath),
    };

    const fakeSnykPath = join(binPath, "snyk");
    await writeFile(
      fakeSnykPath,
      `#!/bin/sh
set -eu
{
  printf 'sha=%s\\n' "$(git rev-parse HEAD)"
  if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    printf 'detached=false\\n'
  else
    printf 'detached=true\\n'
  fi
  printf 'marker=%s\\n' "$(git show HEAD:marker.txt)"
  printf 'token=%s\\n' "\${SNYK_TOKEN-}"
  printf 'args=%s\\n' "$*"
} > "$FAKE_SNYK_CAPTURE"
printf '%s\\n' '{"vulnerabilities":[{"id":"SNYK-INTEGRATION","severity":"high","packageName":"dep","version":"1.0.0"}]}'
`,
    );
    await chmod(fakeSnykPath, 0o755);

    const originalPath = process.env.PATH;
    const originalToken = process.env.CODEPULSE_TEST_SNYK_TOKEN;
    const originalCapture = process.env.FAKE_SNYK_CAPTURE;
    let result: SnykScanResult;
    try {
      process.env.PATH = `${binPath}${delimiter}${originalPath ?? ""}`;
      process.env.CODEPULSE_TEST_SNYK_TOKEN = "custom-token-value";
      process.env.FAKE_SNYK_CAPTURE = capturePath;
      result = await scanSnykCommit(
        { repoPath, sha: targetSha, tokenEnvVar: "CODEPULSE_TEST_SNYK_TOKEN" },
        { cacheRoot },
      );
    } finally {
      restoreEnv("PATH", originalPath);
      restoreEnv("CODEPULSE_TEST_SNYK_TOKEN", originalToken);
      restoreEnv("FAKE_SNYK_CAPTURE", originalCapture);
    }

    expect(result.sha).toBe(targetSha);
    expect(result.counts.high).toBe(1);
    expect((await readFile(capturePath, "utf8")).trim().split("\n")).toEqual([
      `sha=${targetSha}`,
      "detached=true",
      "marker=target commit",
      "token=custom-token-value",
      "args=test --json --all-projects",
    ]);
    expect(await new SnykCache({ root: cacheRoot }).read(repoPath, targetSha)).toEqual(result);
    expect({
      sha: await runLocal(["git", "rev-parse", "HEAD"], repoPath),
      branch: await runLocal(["git", "branch", "--show-current"], repoPath),
      status: await runLocal(["git", "status", "--porcelain"], repoPath),
      marker: await readFile(join(repoPath, "marker.txt"), "utf8"),
      worktrees: await runLocal(["git", "worktree", "list", "--porcelain"], repoPath),
    }).toEqual(checkoutBefore);
  });

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

  test("caches successful projects from partial exit 2 output", async () => {
    const cacheRoot = await root();
    const runner: SnykCommandRunner = async command => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify([
            { error: "unsupported project" },
            {
              projectName: "working",
              vulnerabilities: [{ id: "SNYK-1", severity: "high", packageName: "dep", version: "1.0.0" }],
            },
          ]),
          exitCode: 2,
        };
      }
      return { stdout: "", exitCode: 0 };
    };

    const result = await scanSnykCommit({ repoPath: "/repo", sha: SHA }, { cacheRoot, runCommand: runner });

    expect(result).toMatchObject({ partial: true, failedProjects: 1, counts: { high: 1 } });
    expect(await new SnykCache({ root: cacheRoot }).read("/repo", SHA)).toEqual(result);
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
