import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { addDebugEvent, redactDebugValue } from "../../debug/events";
import { SnykCache } from "./cache";
import { parseSnykOutput, shouldReplaceSnykResult } from "./parser";
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
  const error = new Error("Snyk scan aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

const SNYK_GROUP_KILL_GRACE_MS = 500;

export async function killSnykProcessGroup(pid: number | undefined, signal: NodeJS.Signals): Promise<void> {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return;
  if (process.platform === "win32") {
    const child = Bun.spawn(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) !== 0) {
      // A process that exited before taskkill started needs no further cleanup.
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      throw new Error("Unable to stop Snyk process tree.");
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

async function snykSpawnCommand(command: string[], options: Parameters<SnykCommandRunner>[1]): Promise<string[]> {
  if (process.platform !== "win32" || command[0] !== "snyk") return command;
  const executable =
    Bun.which("snyk.exe", { cwd: options.cwd, PATH: options.env?.PATH }) ??
    Bun.which("snyk.cmd", { cwd: options.cwd, PATH: options.env?.PATH }) ??
    Bun.which("snyk", { cwd: options.cwd, PATH: options.env?.PATH });
  if (!executable) return command;
  if (!/\.cmd$/i.test(executable)) return [executable, ...command.slice(1)];

  // npm's global and local .bin shims both point into a sibling Snyk package.
  // Read its bin metadata rather than passing paths or arguments through cmd.exe.
  const binDirectory = dirname(executable);
  for (const packagePath of [
    join(binDirectory, "node_modules", "snyk", "package.json"),
    join(binDirectory, "..", "snyk", "package.json"),
  ]) {
    let metadata: { bin?: string | { snyk?: string } };
    try {
      metadata = JSON.parse(await readFile(packagePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const entry = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.snyk;
    const node =
      Bun.which(join(binDirectory, "node.exe")) ?? Bun.which("node.exe", { cwd: options.cwd, PATH: options.env?.PATH });
    if (!entry || !node) throw new Error("Unable to resolve the Snyk npm entrypoint or Node.js runtime.");
    return [node, resolve(dirname(packagePath), entry), ...command.slice(1)];
  }
  throw new Error("Unable to resolve the Snyk npm entrypoint for snyk.cmd.");
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

function throwScanFailure(stdout: string, stderr: string | undefined, exitCode: number): never {
  const detail = outputError(stdout, stderr);
  if (detail) addDebugEvent({ source: "Snyk", message: detail, status: "error" });
  if (exitCode === 3) throw new Error("Snyk found no supported dependency project.");
  throw new Error("Snyk scan failed.");
}

export const runSnykCommand: SnykCommandRunner = async (command, options) => {
  throwIfAborted(options.signal);
  if (process.platform === "win32") {
    const env = { ...(options.env ?? process.env) };
    const path = env.PATH ?? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") delete env[key];
    }
    options = { ...options, env: { ...env, PATH: path } };
  }
  const started = Date.now();
  const source = command[0] === "snyk" ? "Snyk" : "Git";
  const message = command.map(redactDebugValue).join(" ");
  const isolateGroup = command[0] === "snyk";
  const spawnCommand = await snykSpawnCommand(command, options);
  throwIfAborted(options.signal);
  const child = Bun.spawn(spawnCommand, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    detached: isolateGroup && process.platform !== "win32",
  });
  let cleanup: Promise<void> | undefined;
  const stopChild = () => {
    cleanup ??= (async () => {
      if (process.platform === "win32") {
        await killSnykProcessGroup(child.pid, "SIGKILL");
      } else if (isolateGroup) {
        await killSnykProcessGroup(child.pid, "SIGTERM");
        await new Promise(resolve => setTimeout(resolve, SNYK_GROUP_KILL_GRACE_MS));
        // The leader may already have exited while descendants are still alive.
        await killSnykProcessGroup(child.pid, "SIGKILL");
      } else if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
      await child.exited;
    })();
    return cleanup;
  };
  const onAbort = () => {
    void stopChild().catch(() => {});
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  try {
    let stdout: string;
    let stderr: string;
    try {
      [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      throw error;
    }
    throwIfAborted(options.signal);
    const exitCode = child.exitCode ?? 1;
    addDebugEvent({ source, message, status: String(exitCode), durationMs: Date.now() - started });
    if (exitCode > 1 && stderr.trim()) {
      addDebugEvent({ source, message: redactDebugValue(stderr.trim()), status: "error" });
    }
    return { stdout, stderr, exitCode };
  } catch (error) {
    void stopChild().catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode == null || options.signal?.aborted) stopChild();
    await cleanup;
  }
};

async function resolveCommitSha(
  repoPath: string,
  revision: string,
  runCommand: SnykCommandRunner,
  signal?: AbortSignal,
): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(revision)) throw new Error("Snyk scan requires a commit SHA.");
  const result = await runCommand(["git", "rev-parse", "--verify", `${revision}^{commit}`], { cwd: repoPath, signal });
  throwIfAborted(signal);
  const sha = result.stdout.trim().toLowerCase();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("Unable to resolve commit SHA.");
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
    throwIfAborted(options.signal);
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
    if (added.exitCode !== 0) throw new Error("Unable to create scan worktree.");

    const tokenEnvVar = options.tokenEnvVar ?? "SNYK_TOKEN";
    const scan = await runCommand(["snyk", "test", "--json", "--all-projects"], {
      cwd: worktreePath,
      signal: options.signal,
      env: { ...process.env, SNYK_TOKEN: process.env[tokenEnvVar] },
    });
    throwIfAborted(options.signal);
    let result: SnykScanResult | null = null;
    if (scan.exitCode === 2) {
      try {
        const parsed = parseSnykOutput(scan.stdout, {
          sha,
          scannedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        });
        if (parsed.partial) result = parsed;
      } catch {}
    }

    if (scan.exitCode !== 0 && scan.exitCode !== 1 && !result) {
      throwScanFailure(scan.stdout, scan.stderr, scan.exitCode);
    }

    if (!result) {
      try {
        result = parseSnykOutput(scan.stdout, {
          sha,
          scannedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid JSON";
        addDebugEvent({ source: "Snyk", message: redactDebugValue(message), status: "error" });
        throw new Error("Snyk returned unusable results.");
      }
    }
    const existing = await cache.read(options.repoPath, sha);
    throwIfAborted(options.signal);
    if (!shouldReplaceSnykResult(existing ?? undefined, result)) {
      throw new Error("Partial scan. Kept last complete snapshot.");
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
