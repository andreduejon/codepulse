import { lstat, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

export interface SnykDependencyProjectInput {
  targetFile: string;
  scanTargetFile: string;
  packageManager: "bun" | "pnpm" | "yarn";
  discoveryError?: string;
}

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
] as const;
const DISCOVERY_ERROR =
  "Unable to inspect this dependency project. Check that tracked package.json contains valid JSON and manifests and lockfiles are readable regular files without symlinks.";

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
  const projects: SnykDependencyProjectInput[] = [];
  if (!directories.some(directory => LOCKFILES.some(([name]) => tracked.has(posix.join(directory, name)))))
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
          typeof packageManager === "string" ? /^(bun|pnpm|yarn)(?:@(.+))?$/.exec(packageManager) : null;
        if (typeof packageManager === "string" && !preferred) continue;
        if (
          !preferred &&
          ["package-lock.json", "npm-shrinkwrap.json"].some(name => tracked.has(posix.join(directory, name)))
        )
          continue;
        selectedLock = locks.find(([, manager]) => manager === preferred?.[1]) ?? selectedLock;
        const modernYarn = preferred?.[1] === "yarn" && Number.parseInt(preferred[2] ?? "1", 10) >= 2;
        const candidates: SnykDependencyProjectInput[] = [];
        for (const [name, manager] of locks) {
          const targetFile = posix.join(directory, name);
          const contents = await readProjectFile(root, targetFile);
          if (
            manager === "yarn" &&
            (modernYarn || !/^# yarn lockfile v1\r?$/m.test(contents) || /^__metadata\s*:/m.test(contents))
          ) {
            continue;
          }
          candidates.push({
            targetFile,
            scanTargetFile: manager === "bun" ? posix.join(directory, "yarn.lock") : targetFile,
            packageManager: manager,
          });
        }
        const project = candidates.find(candidate => candidate.packageManager === preferred?.[1]) ?? candidates[0];
        if (project) projects.push(project);
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
  } catch {
    throw new Error(
      "Unable to discover Snyk projects. Check that tracked package.json files contain valid JSON and manifests and lockfiles are readable regular files without symlinks in the scan worktree.",
    );
  }
  return projects;
}
