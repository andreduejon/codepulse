import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  isRecord,
  type OverrideRule,
  parseNpmOverrides,
  parsePnpmLockfileOverrides,
  parseYarnResolutions,
  rangesOf,
} from "../../core/snyk/overrides";

/** The closest `pnpm-lock.yaml` at or above the graph's directory, inside the worktree. */
async function readPnpmLockfile(worktreePath: string, directory: string): Promise<string | null> {
  for (let current = directory; ; current = posix.dirname(current)) {
    const text = await readFile(join(worktreePath, current, "pnpm-lock.yaml"), "utf8").catch(() => null);
    if (text !== null) return text;
    if (current === ".") return null;
  }
}

/** Overrides from the pnpm lockfile at or above a directory of the worktree. */
export async function pnpmOverrideRules(worktreePath: string, directory: string): Promise<OverrideRule[]> {
  const lockfile = await readPnpmLockfile(worktreePath, directory);
  return lockfile ? parsePnpmLockfileOverrides(lockfile) : [];
}

async function readManifest(worktreePath: string, directory: string): Promise<Record<string, unknown> | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(worktreePath, directory, "package.json"), "utf8"));
    return isRecord(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

/** Ranges the project's own `package.json` asks for (all dependency fields). */
export async function manifestRanges(worktreePath: string, directory: string): Promise<Record<string, string>> {
  const manifest = await readManifest(worktreePath, directory);
  return manifest ? rangesOf(manifest) : {};
}

/**
 * The overrides a project's package manager applies: pnpm's lockfile records them; npm reads `overrides`, Yarn
 * `resolutions` and Bun both, from the `package.json` beside the lockfile (workspace packages' own are ignored).
 */
export async function projectOverrideRules(
  worktreePath: string,
  project: { targetFile: string; packageManager: string },
): Promise<OverrideRule[]> {
  const directory = posix.dirname(project.targetFile);
  const { packageManager } = project;
  if (packageManager === "pnpm") return pnpmOverrideRules(worktreePath, directory);
  if (packageManager !== "npm" && packageManager !== "yarn" && packageManager !== "bun") return [];
  const manifest = await readManifest(worktreePath, directory);
  if (!manifest) return [];
  return [
    ...(packageManager === "yarn" ? [] : parseNpmOverrides(manifest.overrides, rangesOf(manifest))),
    ...(packageManager === "npm" ? [] : parseYarnResolutions(manifest.resolutions)),
  ];
}
