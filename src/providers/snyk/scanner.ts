import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDebugEvent, redactDebugValue } from "../../debug/events";
import { SnykCache } from "./cache";
import { parseSnykOutput } from "./parser";
import type { SnykCacheLimit, SnykScanOptions, SnykScanResult } from "./types";

export interface SnykCommandResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export type SnykCommandRunner = (
  command: string[],
  options: { cwd: string; signal?: AbortSignal; env?: Record<string, string | undefined> },
) => Promise<SnykCommandResult>;

export interface SnykScannerDependencies {
  runCommand?: SnykCommandRunner;
  cacheRoot?: string;
  now?: () => Date;
}

function abortError(): Error {
  const error = new Error("Snyk scan aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isBunOnlyProject(path: string): Promise<boolean> {
  const [hasPackage, bunLock, bunBinaryLock, packageLock, shrinkwrap, yarnLock, pnpmLock] = await Promise.all([
    fileExists(join(path, "package.json")),
    fileExists(join(path, "bun.lock")),
    fileExists(join(path, "bun.lockb")),
    fileExists(join(path, "package-lock.json")),
    fileExists(join(path, "npm-shrinkwrap.json")),
    fileExists(join(path, "yarn.lock")),
    fileExists(join(path, "pnpm-lock.yaml")),
  ]);
  const hasBunLock = bunLock || bunBinaryLock;
  const hasSupportedLock = packageLock || shrinkwrap || yarnLock || pnpmLock;
  return hasPackage && hasBunLock && !hasSupportedLock;
}

function outputError(stdout: string, stderr: string | undefined): string {
  const stderrMessage = stderr?.trim();
  if (stderrMessage) return redactDebugValue(stderrMessage);
  try {
    const parsed: unknown = JSON.parse(stdout);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      for (const key of ["userMessage", "error", "message"]) {
        if (typeof value[key] === "string" && value[key].trim()) return redactDebugValue(value[key].trim());
      }
    }
  } catch {}
  return "";
}

export const runSnykCommand: SnykCommandRunner = async (command, options) => {
  throwIfAborted(options.signal);
  const started = Date.now();
  const source = command[0] === "snyk" ? "Snyk" : "Git";
  const message = command.map(redactDebugValue).join(" ");
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const onAbort = () => {
    try {
      process.kill();
    } catch {}
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let stdout: string;
    let stderr: string;
    try {
      [stdout, stderr] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      throw error;
    }
    throwIfAborted(options.signal);
    const exitCode = process.exitCode ?? 1;
    addDebugEvent({ source, message, status: String(exitCode), durationMs: Date.now() - started });
    if (exitCode > 1 && stderr.trim()) {
      addDebugEvent({ source, message: redactDebugValue(stderr.trim()), status: "error" });
    }
    return { stdout, stderr, exitCode };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
};

async function resolveCommitSha(
  repoPath: string,
  revision: string,
  runCommand: SnykCommandRunner,
  signal?: AbortSignal,
): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(revision)) throw new Error("Snyk scan requires a commit SHA");
  const result = await runCommand(["git", "rev-parse", "--verify", `${revision}^{commit}`], { cwd: repoPath, signal });
  throwIfAborted(signal);
  const sha = result.stdout.trim().toLowerCase();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha))
    throw new Error("Unable to resolve Snyk scan commit SHA");
  return sha;
}

export async function scanSnykCommit(
  options: SnykScanOptions,
  dependencies: SnykScannerDependencies = {},
): Promise<SnykScanResult> {
  const runCommand = dependencies.runCommand ?? runSnykCommand;
  const cache = new SnykCache({ root: dependencies.cacheRoot, maxEntries: options.maxCachedScans });
  const sha = await resolveCommitSha(options.repoPath, options.sha, runCommand, options.signal);
  if (!options.force) {
    const cached = await cache.read(options.repoPath, sha);
    if (cached) return cached;
  }

  throwIfAborted(options.signal);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "codepulse-snyk-"));
  const worktreePath = join(temporaryRoot, "worktree");
  try {
    const added = await runCommand(["git", "worktree", "add", "--detach", worktreePath, sha], {
      cwd: options.repoPath,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    if (added.exitCode !== 0) throw new Error("Unable to create Snyk scan worktree");

    const tokenEnvVar = options.tokenEnvVar ?? "SNYK_TOKEN";
    const scan = await runCommand(["snyk", "test", "--json", "--all-projects"], {
      cwd: worktreePath,
      signal: options.signal,
      env: { ...process.env, SNYK_TOKEN: process.env[tokenEnvVar] },
    });
    throwIfAborted(options.signal);
    if (scan.exitCode !== 0 && scan.exitCode !== 1) {
      if (await isBunOnlyProject(worktreePath)) {
        throw new Error(
          "Snyk Open Source cannot scan Bun lockfiles. Add package-lock.json, yarn.lock, or pnpm-lock.yaml.",
        );
      }
      const detail = outputError(scan.stdout, scan.stderr);
      const fallback = scan.exitCode === 3 ? "no supported dependency project detected" : "operational failure";
      throw new Error(detail || `exit code ${scan.exitCode}: ${fallback}`);
    }

    let result: SnykScanResult;
    try {
      result = parseSnykOutput(scan.stdout, {
        sha,
        scannedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`Snyk returned unusable results: ${message}`);
    }
    await cache.write(options.repoPath, result);
    return result;
  } finally {
    await runCommand(["git", "worktree", "remove", "--force", worktreePath], { cwd: options.repoPath }).catch(() => {});
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getCachedSnykScan(
  repoPath: string,
  sha: string,
  options: { cacheRoot?: string; maxCachedScans?: SnykCacheLimit } = {},
): Promise<SnykScanResult | null> {
  return new SnykCache({ root: options.cacheRoot, maxEntries: options.maxCachedScans }).read(repoPath, sha);
}
