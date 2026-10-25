import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { addDebugEvent, redactDebugValue } from "../../debug/events";
import { SnykCache } from "./cache";
import { normalizeSnykTargetFile, parseSnykDepGraphs } from "./dep-graph";
import { parseSnykOutput, shouldReplaceSnykResult } from "./parser";
import { discoverSnykDependencyProjects, type SnykDependencyProjectInput } from "./projects";
import type {
  SnykCacheLimit,
  SnykDependencyGraph,
  SnykDependencyProjectResult,
  SnykScanOptions,
  SnykScanResult,
} from "./types";

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
  which?: (command: string) => string | null;
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
      // shortcut: taskkill loses descendants after the leader exits; use Job Objects for full Windows ownership.
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
  if (process.platform === "win32" && command[0] === "bun") {
    const executable = Bun.which("bun.exe", { cwd: options.cwd, PATH: options.env?.PATH });
    if (!executable) throw new Error("Bun executable not found on PATH. Install Bun to scan bun.lock.");
    return [executable, ...command.slice(1)];
  }
  if (process.platform !== "win32" || command[0] !== "snyk") return command;
  const executable =
    Bun.which("snyk.exe", { cwd: options.cwd, PATH: options.env?.PATH }) ??
    Bun.which("snyk.cmd", { cwd: options.cwd, PATH: options.env?.PATH }) ??
    Bun.which("snyk", { cwd: options.cwd, PATH: options.env?.PATH });
  if (!executable) return command;
  if (!/\.cmd$/i.test(executable)) return [executable, ...command.slice(1)];

  // Resolve known npm/Yarn shim layouts directly rather than interpolating arguments through cmd.exe.
  const binDirectory = dirname(executable);
  for (const packagePath of [
    join(binDirectory, "node_modules", "snyk", "package.json"),
    join(binDirectory, "..", "snyk", "package.json"),
    join(binDirectory, "..", "Data", "global", "node_modules", "snyk", "package.json"),
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
  const source = command[0] === "git" ? "Git" : "Snyk";
  const message = command.map(redactDebugValue).join(" ");
  const isolateGroup = command[0] !== "git";
  const spawnCommand = await snykSpawnCommand(command, options);
  throwIfAborted(options.signal);
  const child = (() => {
    try {
      return Bun.spawn(spawnCommand, {
        cwd: options.cwd,
        env: options.env,
        stdout: "pipe",
        stderr: "pipe",
        detached: isolateGroup && process.platform !== "win32",
      });
    } catch (error) {
      if (command[0] === "snyk" && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Snyk CLI not found on PATH. Install Snyk CLI to scan.");
      }
      throw error;
    }
  })();
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

const SCAN_ROOT_PREFIX = "codepulse-snyk-";
const SCAN_ROOT_PATTERN = /^codepulse-snyk-(\d+)-[^/\\]+$/;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove scan worktrees left by codepulse processes that died before their cleanup ran
 * (killed, terminal closed). Only `worktree` folders inside `codepulse-snyk-<pid>-…` roots of dead PIDs are touched.
 */
export async function removeOrphanedScanWorktrees(
  repoPath: string,
  runCommand: SnykCommandRunner = runSnykCommand,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const listed = await runCommand(["git", "worktree", "list", "--porcelain"], { cwd: repoPath, signal });
    if (listed.exitCode !== 0) return;
    for (const line of listed.stdout.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const path = line.slice("worktree ".length).trim();
      const pid = Number(SCAN_ROOT_PATTERN.exec(basename(dirname(path)))?.[1]);
      if (basename(path) !== "worktree" || !pid || pid === process.pid || isProcessAlive(pid)) continue;
      await runCommand(["git", "worktree", "remove", "--force", path], { cwd: repoPath, signal });
      await rm(dirname(path), { recursive: true, force: true });
    }
  } catch {
    // Best effort: housekeeping must never block a scan.
  }
}

function projectForTarget(
  target: string,
  projects: readonly SnykDependencyProjectInput[],
  trackedFiles: readonly string[],
  packageManager?: string,
): SnykDependencyProjectInput | undefined {
  const normalized = target.replaceAll("\\", "/");
  // Snyk reports every pom.xml under its own path, so Maven graphs match exactly.
  if (packageManager === "maven")
    return projects.find(project => project.packageManager === "maven" && project.targetFile === normalized);
  const containsTarget = (file: string) =>
    posix.dirname(file) === "." || normalized.startsWith(`${posix.dirname(file)}/`);
  const closestLockfile = trackedFiles
    .filter(
      file =>
        ["bun.lock", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json"].includes(
          posix.basename(file),
        ) && containsTarget(file),
    )
    .sort((left, right) => right.split("/").length - left.split("/").length)[0];
  return projects
    .filter(project => {
      if (project.packageManager === "maven") return false;
      if (packageManager && (project.packageManager === "bun" ? "yarn" : project.packageManager) !== packageManager) {
        return false;
      }
      if (closestLockfile && posix.dirname(closestLockfile) !== posix.dirname(project.targetFile)) return false;
      return containsTarget(project.targetFile);
    })
    .sort((left, right) => right.targetFile.split("/").length - left.targetFile.split("/").length)[0];
}

async function prepareDependencyProjects(
  projects: readonly SnykDependencyProjectInput[],
  worktreePath: string,
  options: SnykScanOptions,
  dependencies: SnykScannerDependencies,
): Promise<Map<string, SnykDependencyProjectResult>> {
  const unavailable = new Map<string, SnykDependencyProjectResult>();
  for (const project of projects) {
    if (project.discoveryError) {
      unavailable.set(project.targetFile, {
        targetFile: project.targetFile,
        packageManager: project.packageManager,
        status: "failed",
        graphs: [],
        reason: project.discoveryError,
      });
      continue;
    }
    if (project.packageManager === "maven") {
      const mvn = process.platform === "win32" ? "mvn.cmd" : "mvn";
      if (!project.mavenWrapper && !(dependencies.which ?? Bun.which)(mvn))
        unavailable.set(project.targetFile, {
          targetFile: project.targetFile,
          packageManager: "maven",
          status: "skipped",
          graphs: [],
          reason: "Maven not found on PATH. Install Maven or commit the Maven Wrapper (mvnw) to scan pom.xml.",
        });
      continue;
    }
    if (project.packageManager !== "bun") continue;
    throwIfAborted(options.signal);
    let reason: string | null = null;
    let status: "skipped" | "failed" = "failed";
    if (!(dependencies.which ?? Bun.which)(process.platform === "win32" ? "bun.exe" : "bun")) {
      reason = "Bun not found on PATH. Install Bun to scan bun.lock.";
      status = "skipped";
    } else {
      try {
        const lockfilePath = join(worktreePath, project.targetFile);
        const yarnPath = join(worktreePath, project.scanTargetFile);
        const previousYarn = await lstat(yarnPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return null;
        });
        if (previousYarn && !previousYarn.isFile()) throw new Error("Unsafe Yarn output file.");
        const originalLockfile = await readFile(lockfilePath);
        const conversion = await (dependencies.runCommand ?? runSnykCommand)(
          ["bun", "install", "--yarn", "--frozen-lockfile", "--ignore-scripts"],
          { cwd: join(worktreePath, posix.dirname(project.targetFile)), signal: options.signal },
        );
        throwIfAborted(options.signal);
        if (conversion.exitCode !== 0)
          reason = "Bun lockfile conversion failed. Check Bun and registry access, then rescan.";
        else if (!(await lstat(yarnPath)).isFile()) reason = "Bun conversion did not produce a regular yarn.lock file.";
        else if (!originalLockfile.equals(await readFile(lockfilePath)))
          reason = "Bun conversion changed bun.lock. Rescan with a compatible Bun version.";
      } catch (error) {
        throwIfAborted(options.signal);
        reason =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "Bun conversion could not read or create its lockfiles. Check Bun, then rescan."
            : "Bun lockfile conversion failed. Check Bun and registry access, then rescan.";
      }
    }
    if (reason)
      unavailable.set(project.targetFile, {
        targetFile: project.targetFile,
        packageManager: "bun",
        status,
        graphs: [],
        reason,
      });
  }
  return unavailable;
}

function findingsWithoutUnavailableBun(
  stdout: string,
  projects: readonly SnykDependencyProjectInput[],
  unavailable: ReadonlyMap<string, SnykDependencyProjectResult>,
  trackedFiles: readonly string[],
): unknown {
  const parsed: unknown = JSON.parse(stdout);
  const unavailableBun = new Map([...unavailable].filter(([, project]) => project.packageManager === "bun"));
  if (unavailableBun.size === 0) return parsed;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const retained = entries.filter(value => {
    if (!value || typeof value !== "object") return true;
    const entry = value as Record<string, unknown>;
    const target = entry.displayTargetFile ?? entry.targetFile;
    if (
      typeof target !== "string" ||
      !["package.json", "package-lock.json", "yarn.lock", "bun.lock", "pnpm-lock.yaml"].includes(
        posix.basename(target.replaceAll("\\", "/")),
      )
    )
      return true;
    const project = projectForTarget(target, projects, trackedFiles);
    return !project || !unavailableBun.has(project.targetFile);
  });
  return [...retained, ...[...unavailableBun.values()].map(project => ({ error: project.reason }))];
}

export interface SnykProjectFailures {
  count: number;
  /** Repository-relative manifests Snyk named; may be fewer than `count`. */
  targets: string[];
}

const NO_PROJECT_FAILURES: SnykProjectFailures = { count: 0, targets: [] };

/**
 * Projects Snyk found but could not resolve (`✗ 1/6 potential projects failed to get dependencies.`, each preceded by
 * `<absolute manifest path>:`). Snyk prints them only on stderr, and `--json` leaves them out entirely.
 */
export function parseSnykProjectFailures(stderr: string, roots: readonly string[]): SnykProjectFailures {
  const summary = /(\d+)\/\d+ potential projects? failed to get dependencies/.exec(stderr);
  if (!summary) return NO_PROJECT_FAILURES;
  const targets = new Set<string>();
  for (const line of stderr.split(/\r?\n/)) {
    const path = /^(.+):$/.exec(line.trim())?.[1];
    if (!path || !isAbsolute(path)) continue;
    for (const root of roots) {
      const target = normalizeSnykTargetFile(relative(root, path));
      if (target) {
        targets.add(target);
        break;
      }
    }
  }
  const count = Math.max(Number(summary[1]), targets.size);
  return { count, targets: [...targets].sort() };
}

async function scanDependencyProjects(
  projects: readonly SnykDependencyProjectInput[],
  unavailable: ReadonlyMap<string, SnykDependencyProjectResult>,
  commandOptions: Parameters<SnykCommandRunner>[1],
  runCommand: SnykCommandRunner,
  trackedFiles: readonly string[],
): Promise<{ projects: SnykDependencyProjectResult[]; failures: SnykProjectFailures }> {
  const ready = projects.filter(project => !unavailable.has(project.targetFile));
  if (ready.length === 0) return { projects: [...unavailable.values()], failures: NO_PROJECT_FAILURES };
  let graphs: ReturnType<typeof parseSnykDepGraphs> = [];
  let reason: string | null = null;
  let failures = NO_PROJECT_FAILURES;
  try {
    const scan = await runCommand(["snyk", "test", "--print-graph", "--all-projects", "--dev"], commandOptions);
    throwIfAborted(commandOptions.signal);
    graphs = parseSnykDepGraphs(scan.stdout);
    // Snyk prints realpaths (macOS `/var` is `/private/var`), so match both spellings of the worktree.
    const roots = [commandOptions.cwd, await realpath(commandOptions.cwd).catch(() => commandOptions.cwd)];
    failures = parseSnykProjectFailures(scan.stderr ?? "", roots);
    if (scan.exitCode !== 0 && scan.exitCode !== 1)
      reason = "Snyk dependency graph scan was incomplete. Returned graphs are partial results.";
  } catch (error) {
    throwIfAborted(commandOptions.signal);
    reason =
      error instanceof Error && error.message === "Unsupported Snyk CLI output."
        ? error.message
        : "Snyk dependency graph scan failed. Check Snyk CLI and authentication, then rescan.";
  }
  const pending: Promise<void>[] = [];
  const results = projects.map((project): SnykDependencyProjectResult => {
    const blocked = unavailable.get(project.targetFile);
    if (blocked) return blocked;
    const matches = graphs.filter(
      graph => projectForTarget(graph.targetFile, ready, trackedFiles, graph.packageManager) === project,
    );
    pending.push(...matches.map(graph => applyManifestScopes(graph, commandOptions.cwd)));
    const failure =
      reason ??
      (matches.length === 0
        ? project.packageManager === "maven"
          ? "Snyk returned no dependency graph for this pom.xml. Check that Java and Maven can resolve its dependencies, then rescan."
          : "Snyk returned no dependency graph for this project."
        : null);
    return {
      targetFile: project.targetFile,
      packageManager: project.packageManager,
      status: failure ? "failed" : "scanned",
      graphs: matches,
      reason: failure,
    };
  });
  await Promise.all(pending);
  return { projects: results, failures };
}

const MANIFEST_PACKAGE_MANAGERS = new Set(["npm", "yarn", "pnpm", "bun"]);

/**
 * Snyk can flag runtime packages as dev when dev tools also use them (seen in pnpm graphs). Direct dependencies
 * take their scope from the `package.json` beside the graph instead; without a readable manifest Snyk's flags stay.
 */
export async function applyManifestScopes(graph: SnykDependencyGraph, worktreePath: string): Promise<void> {
  if (!MANIFEST_PACKAGE_MANAGERS.has(graph.packageManager)) return;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(worktreePath, posix.dirname(graph.targetFile), "package.json"), "utf8"));
  } catch {
    return;
  }
  const names = (field: string) => {
    const value = manifest?.[field];
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  };
  const prod = new Set(["dependencies", "optionalDependencies", "peerDependencies"].flatMap(names));
  const dev = new Set(names("devDependencies"));
  const packages = new Map(graph.packages.map(pkg => [pkg.id, pkg.name]));
  const root = graph.nodes.find(node => node.nodeId === graph.rootNodeId);
  const direct = new Set(root?.deps ?? []);
  for (const node of graph.nodes) {
    if (!direct.has(node.nodeId)) continue;
    const name = packages.get(node.pkgId) ?? "";
    if (prod.has(name)) node.scope = "prod";
    else if (dev.has(name)) node.scope = "dev";
  }
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
  await removeOrphanedScanWorktrees(options.repoPath, runCommand, options.signal);
  throwIfAborted(options.signal);
  // The PID in the name lets later scans tell orphaned worktrees from another live instance's.
  const temporaryRoot = await mkdtemp(join(tmpdir(), `${SCAN_ROOT_PREFIX}${process.pid}-`));
  const worktreePath = join(temporaryRoot, "worktree");
  try {
    const added = await runCommand(["git", "worktree", "add", "--detach", worktreePath, sha], {
      cwd: options.repoPath,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    if (added.exitCode !== 0) throw new Error("Unable to create scan worktree.");

    const tracked = await runCommand(["git", "ls-files", "-z"], { cwd: worktreePath, signal: options.signal });
    throwIfAborted(options.signal);
    if (tracked.exitCode !== 0) throw new Error("Unable to inspect dependency projects at the selected commit.");
    const trackedFiles = tracked.stdout.split("\0").filter(Boolean);
    const projects = await discoverSnykDependencyProjects(worktreePath, trackedFiles);
    const unavailable = await prepareDependencyProjects(projects, worktreePath, options, dependencies);
    const unavailableBunReason = [...unavailable.values()].find(project => project.packageManager === "bun")?.reason;
    const tokenEnvVar = options.tokenEnvVar ?? "SNYK_TOKEN";
    const commandOptions = {
      cwd: worktreePath,
      signal: options.signal,
      env: { ...process.env, SNYK_TOKEN: process.env[tokenEnvVar] },
    };
    const scan = await runCommand(["snyk", "test", "--json", "--all-projects", "--dev"], commandOptions);
    throwIfAborted(options.signal);
    let result: SnykScanResult | null = null;
    if (scan.exitCode === 2) {
      try {
        const parsed = parseSnykOutput(
          findingsWithoutUnavailableBun(scan.stdout, projects, unavailable, trackedFiles),
          {
            sha,
            scannedAt: (dependencies.now?.() ?? new Date()).toISOString(),
          },
        );
        if (parsed.partial) result = parsed;
      } catch {}
    }

    if (scan.exitCode !== 0 && scan.exitCode !== 1 && !result) {
      if (unavailableBunReason) throw new Error(unavailableBunReason);
      throwScanFailure(scan.stdout, scan.stderr, scan.exitCode);
    }

    if (!result) {
      try {
        result = parseSnykOutput(findingsWithoutUnavailableBun(scan.stdout, projects, unavailable, trackedFiles), {
          sha,
          scannedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        });
      } catch (error) {
        if (unavailableBunReason) throw new Error(unavailableBunReason);
        const message = error instanceof Error ? error.message : "invalid JSON";
        addDebugEvent({ source: "Snyk", message: redactDebugValue(message), status: "error" });
        throw new Error("Snyk returned unusable results.");
      }
    }
    const graphRun = await scanDependencyProjects(projects, unavailable, commandOptions, runCommand, trackedFiles);
    result.dependencyProjects = graphRun.projects;
    // Both runs detect the same projects; only the graph run reports the ones Snyk could not resolve.
    const failedProjects = Math.max(result.failedProjects ?? 0, graphRun.failures.count);
    if (failedProjects > 0) {
      result.partial = true;
      result.failedProjects = failedProjects;
      if (graphRun.failures.targets.length > 0) result.failedTargets = graphRun.failures.targets;
    }
    const existing = await cache.read(options.repoPath, sha);
    throwIfAborted(options.signal);
    if (!shouldReplaceSnykResult(existing ?? undefined, result, options.force)) {
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
