import { lstat, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import type { SnykDependencyPackageManager } from "./types";

export interface SnykDependencyProjectInput {
  targetFile: string;
  scanTargetFile: string;
  packageManager: SnykDependencyPackageManager;
  discoveryError?: string;
  /** Maven only: a tracked Maven Wrapper beside the pom or in a parent directory, which Snyk uses instead of `mvn`. */
  mavenWrapper?: boolean;
}

// npm first: Snyk scans package-lock.json over other lockfiles in the same directory.
const LOCKFILES = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
] as const;
const DISCOVERY_ERROR =
  "Unable to inspect this dependency project. Check that tracked package.json contains valid JSON and manifests and lockfiles are readable regular files without symlinks.";
const MAVEN_DISCOVERY_ERROR =
  "Unable to inspect this Maven project. Check that tracked pom.xml is a readable regular file without symlinks.";
const MAVEN_WRAPPER = process.platform === "win32" ? "mvnw.cmd" : "mvnw";

function normalizeTrackedPath(file: string): string {
  const path = file.replaceAll("\\", "/");
  const parts = path.split("/");
  const normalized = parts.filter(part => part && part !== ".").join("/");
  if (
    !normalized ||
    path.startsWith("/") ||
    path.includes("\0") ||
    parts.some(part => part === ".." || /^[a-z]:/i.test(part))
  ) {
    throw new Error("Unable to discover Snyk projects: use safe repository-relative tracked paths without '..'.");
  }
  return normalized;
}

async function readProjectFile(worktreePath: string, file: string): Promise<string> {
  const parts = file.split("/");
  let path = worktreePath;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const stats = await lstat(path);
    if (index === parts.length - 1 ? !stats.isFile() : !stats.isDirectory()) {
      throw new Error("Project files must be regular files without symlinks.");
    }
  }
  return readFile(path, "utf8");
}

export async function discoverSnykDependencyProjects(
  worktreePath: string,
  trackedFiles: readonly string[],
): Promise<SnykDependencyProjectInput[]> {
  const tracked = new Set(
    trackedFiles
      .map(normalizeTrackedPath)
      .filter(file => !file.split("/").some(part => part === "node_modules" || part === ".git")),
  );
  const directories = [...tracked]
    .filter(file => posix.basename(file) === "package.json")
    .map(file => posix.dirname(file))
    .sort();
  const poms = [...tracked].filter(file => posix.basename(file) === "pom.xml").sort();
  const projects: SnykDependencyProjectInput[] = [];
  if (
    poms.length === 0 &&
    !directories.some(directory => LOCKFILES.some(([name]) => tracked.has(posix.join(directory, name))))
  )
    return projects;
  const root = resolve(worktreePath);
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Invalid scan worktree.");
    for (const directory of directories) {
      const locks = LOCKFILES.filter(([name]) => tracked.has(posix.join(directory, name)));
      if (locks.length === 0) continue;
      let selectedLock = locks[0];
      try {
        const manifest: unknown = JSON.parse(await readProjectFile(root, posix.join(directory, "package.json")));
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
          throw new Error("Invalid package manifest.");
        }
        const packageManager = (manifest as { packageManager?: unknown }).packageManager;
        const preferred =
          typeof packageManager === "string" ? /^(bun|npm|pnpm|yarn)(?:@(.+))?$/.exec(packageManager) : null;
        if (typeof packageManager === "string" && !preferred) continue;
        selectedLock = locks.find(([, manager]) => manager === preferred?.[1]) ?? selectedLock;
        // Every lockfile must be a readable regular file, even when another one is chosen.
        for (const [name] of locks) await readProjectFile(root, posix.join(directory, name));
        const [name, manager] = selectedLock;
        const targetFile = posix.join(directory, name);
        projects.push({
          targetFile,
          scanTargetFile: manager === "bun" ? posix.join(directory, "yarn.lock") : targetFile,
          packageManager: manager,
        });
      } catch {
        const [name, packageManager] = selectedLock;
        projects.push({
          targetFile: posix.join(directory, name),
          scanTargetFile: posix.join(directory, packageManager === "bun" ? "yarn.lock" : name),
          packageManager,
          discoveryError: DISCOVERY_ERROR,
        });
      }
    }
    // Snyk scans every pom.xml as its own project, modules and aggregator parents alike.
    for (const pom of poms) {
      const project: SnykDependencyProjectInput = {
        targetFile: pom,
        scanTargetFile: pom,
        packageManager: "maven",
        mavenWrapper: hasMavenWrapper(tracked, posix.dirname(pom)),
      };
      try {
        await readProjectFile(root, pom);
        projects.push(project);
      } catch {
        projects.push({ ...project, discoveryError: MAVEN_DISCOVERY_ERROR });
      }
    }
  } catch {
    throw new Error(
      "Unable to discover Snyk projects. Check that tracked package.json files contain valid JSON and manifests and lockfiles are readable regular files without symlinks in the scan worktree.",
    );
  }
  return projects;
}

function hasMavenWrapper(tracked: ReadonlySet<string>, directory: string): boolean {
  for (let current = directory; ; current = posix.dirname(current)) {
    if (tracked.has(posix.join(current, MAVEN_WRAPPER))) return true;
    if (current === ".") return false;
  }
}
