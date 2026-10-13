import { afterEach, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { closeProviderCaches } from "../shared/sha-sqlite-cache";
import { SnykCache } from "./cache";
import { killSnykProcessGroup, runSnykCommand, type SnykCommandRunner, scanSnykCommit } from "./scanner";
import type { SnykScanResult } from "./types";

const SHA = "a".repeat(40);
const roots: string[] = [];

afterEach(async () => {
  for (const path of roots) {
    closeProviderCaches(path);
    closeProviderCaches(join(path, "cache"));
  }
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

async function fakeSnyk(binPath: string, script: string, local = false): Promise<Record<string, string | undefined>> {
  await mkdir(binPath, { recursive: true });
  const packagePath = local ? join(binPath, "..", "snyk") : join(binPath, "node_modules", "snyk");
  await mkdir(packagePath, { recursive: true });
  const entryPath = join(packagePath, "cli.js");
  await writeFile(join(packagePath, "package.json"), JSON.stringify({ bin: { snyk: "cli.js" } }));
  await writeFile(entryPath, script);
  if (process.platform === "win32") {
    await copyFile(process.execPath, join(binPath, "node.exe"));
    const relativeEntry = local ? "..\\snyk\\cli.js" : "node_modules\\snyk\\cli.js";
    await writeFile(join(binPath, "snyk.cmd"), `@echo off\r\n"%~dp0node.exe" "%~dp0${relativeEntry}" %*\r\n`);
  } else {
    const executable = join(binPath, "snyk");
    await writeFile(executable, '#!/bin/sh\nexec "$FAKE_SNYK_BUN" "$FAKE_SNYK_ENTRY" "$@"\n');
    await chmod(executable, 0o755);
  }
  return {
    ...process.env,
    PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_SNYK_BUN: process.execPath,
    FAKE_SNYK_ENTRY: entryPath,
  };
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await Bun.sleep(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("scanSnykCommit", () => {
  test("scans an exact commit with real git and a PATH-resolved Snyk executable", async () => {
    const testRoot = await root();
    const repoPath = join(testRoot, "repo");
    const binPath = join(testRoot, "bin space & (literal) %PATH% 'quote'");
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

    const fixtureEnv = await fakeSnyk(
      binPath,
      `const { writeFileSync } = require("node:fs");
const git = (...args) => Bun.spawnSync(["git", ...args]);
writeFileSync(process.env.FAKE_SNYK_CAPTURE, [
  "sha=" + git("rev-parse", "HEAD").stdout.toString().trim(),
  "detached=" + (git("symbolic-ref", "-q", "HEAD").exitCode !== 0),
  "marker=" + git("show", "HEAD:marker.txt").stdout.toString().trim(),
  "token=" + process.env.SNYK_TOKEN,
  "args=" + process.argv.slice(2).join(" "),
].join("\\n"));
console.log(JSON.stringify({vulnerabilities:[{id:"SNYK-INTEGRATION",severity:"high",packageName:"dep",version:"1.0.0"}]}));
process.exit(1);
`,
    );

    const originalPath = process.env.PATH;
    const originalToken = process.env.CODEPULSE_TEST_SNYK_TOKEN;
    const originalCapture = process.env.FAKE_SNYK_CAPTURE;
    const originalBun = process.env.FAKE_SNYK_BUN;
    const originalEntry = process.env.FAKE_SNYK_ENTRY;
    let result: SnykScanResult;
    try {
      process.env.PATH = fixtureEnv.PATH;
      process.env.FAKE_SNYK_BUN = fixtureEnv.FAKE_SNYK_BUN;
      process.env.FAKE_SNYK_ENTRY = fixtureEnv.FAKE_SNYK_ENTRY;
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
      restoreEnv("FAKE_SNYK_BUN", originalBun);
      restoreEnv("FAKE_SNYK_ENTRY", originalEntry);
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
    ).rejects.toThrow("Snyk scan failed.");
    expect(commands.some(command => command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
    expect(await cache.read("/repo", SHA)).toEqual(old);
  });

  test("does not replace a complete cache entry with a partial rescan", async () => {
    const cacheRoot = await root();
    const cache = new SnykCache({ root: cacheRoot });
    const complete: SnykScanResult = {
      sha: SHA,
      scannedAt: "2026-08-20T10:00:00.000Z",
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      findings: [
        {
          id: "SNYK-OLD",
          title: "Old",
          severity: "high",
          dependency: "dep",
          installedVersion: "1.0.0",
          fixedVersion: null,
          project: "working",
          targetFile: null,
        },
      ],
    };
    await cache.write("/repo", complete);
    const runner: SnykCommandRunner = async command => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify([{ error: "unsupported project" }, { projectName: "working", vulnerabilities: [] }]),
          exitCode: 2,
        };
      }
      return { stdout: "", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, force: true }, { cacheRoot, runCommand: runner }),
    ).rejects.toThrow("Partial scan. Kept last complete snapshot.");
    expect(await cache.read("/repo", SHA)).toEqual(complete);
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

  test("passes shell metacharacters as literal Snyk arguments", async () => {
    const testRoot = await root();
    const env = await fakeSnyk(
      join(testRoot, "bin & space %PATH%"),
      "console.log(JSON.stringify(process.argv.slice(2)));process.exit(3);",
      true,
    );
    const args = ["test", "space value", "a&b", "%PATH%", "$(echo injected)", 'a"quote', "a'b", "end\\"];
    const result = await runSnykCommand(["snyk", ...args], { cwd: testRoot, env });
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.exitCode).toBe(3);
  });

  test("pre-abort never starts Snyk", async () => {
    const testRoot = await root();
    const capture = join(testRoot, "started");
    const env = await fakeSnyk(
      join(testRoot, "bin"),
      `require("node:fs").writeFileSync(${JSON.stringify(capture)}, "started");`,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSnykCommand(["snyk", "test"], { cwd: testRoot, env, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(capture)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleans the worktree after a command startup error", async () => {
    const testRoot = await root();
    let worktreePath = "";
    let removed = false;
    const runner: SnykCommandRunner = async (command, options) => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return runSnykCommand([join(testRoot, "missing-executable")], options);
      }
      if (command[2] === "add") {
        worktreePath = command[4] ?? "";
        await mkdir(worktreePath);
      } else if (command[2] === "remove") {
        removed = true;
      }
      return { stdout: "", exitCode: 0 };
    };
    await expect(
      scanSnykCommit({ repoPath: testRoot, sha: SHA }, { cacheRoot: join(testRoot, "cache"), runCommand: runner }),
    ).rejects.toThrow();
    expect(removed).toBe(true);
    await expect(readFile(worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("awaits cancellation of a Bun parent and descendant before worktree removal", async () => {
    const testRoot = await root();
    const ready = join(testRoot, "ready");
    const heartbeat = join(testRoot, "heartbeat");
    const descendantPath = join(testRoot, "descendant.js");
    await writeFile(
      descendantPath,
      `
const { writeFileSync, renameSync, existsSync } = require("node:fs");
process.on("SIGTERM", () => {});
const publish = (path, text) => {
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
};
publish(process.env.FAKE_READY, JSON.stringify({ pid: process.pid, parentPid: process.ppid }));
setInterval(() => publish(process.env.FAKE_HEARTBEAT, String(Date.now()) + ":" + existsSync(process.cwd())), 10);
`,
    );
    const env = await fakeSnyk(
      join(testRoot, "bin"),
      `
const child = Bun.spawn([process.env.FAKE_SNYK_BUN, ${JSON.stringify(descendantPath)}], { stdout: "ignore", stderr: "ignore" });
setInterval(() => {}, 1000);
`,
    );
    env.FAKE_READY = ready;
    env.FAKE_HEARTBEAT = heartbeat;
    const controller = new AbortController();
    let parentPid: number | undefined;
    let descendantPid: number | undefined;
    let worktreePath = "";
    let cleanupHeartbeat: { before: string; after: string } | undefined;
    let finished = false;
    const runner: SnykCommandRunner = async (command, options) => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[1] === "worktree" && command[2] === "add") {
        worktreePath = command[4] ?? "";
        await mkdir(worktreePath);
        return { stdout: "", exitCode: 0 };
      }
      if (command[0] === "snyk") {
        return runSnykCommand(command, { ...options, env });
      }
      // The runner must finish tree cleanup before scanSnykCommit reaches here.
      const before = await readFile(heartbeat, "utf8");
      await Bun.sleep(100);
      cleanupHeartbeat = { before, after: await readFile(heartbeat, "utf8") };
      return { stdout: "", exitCode: 0 };
    };
    const scan = scanSnykCommit(
      { repoPath: testRoot, sha: SHA, signal: controller.signal },
      { cacheRoot: join(testRoot, "cache"), runCommand: runner },
    );
    const outcome = scan.then(
      () => null,
      error => error,
    );
    try {
      const pids = JSON.parse(await waitForFile(ready));
      descendantPid = pids.pid;
      parentPid = pids.parentPid;
      await waitForFile(heartbeat);
      controller.abort();
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(cleanupHeartbeat).toBeDefined();
      expect(cleanupHeartbeat?.after).toBe(cleanupHeartbeat?.before);
      expect(cleanupHeartbeat?.before.endsWith(":true")).toBe(true);
      if (!parentPid) throw new Error("Fixture did not report its parent PID.");
      const stoppedParentPid = parentPid;
      expect(() => process.kill(stoppedParentPid, 0)).toThrow();
      await expect(readFile(worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
      finished = true;
    } finally {
      controller.abort();
      await scan.catch(() => {});
      // Also stop the fixture if an assertion failed before cancellation completed.
      if (!finished && parentPid) await killSnykProcessGroup(parentPid, "SIGKILL");
      if (!finished && descendantPid) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {}
      }
    }
  }, 15000);

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
