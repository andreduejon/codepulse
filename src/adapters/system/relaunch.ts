/**
 * codepulse started again on another repository, in place of this process: the same executable (the standalone
 * binary, or Bun with the entry script) with the path as its argument, its exit status passed on. Arguments go as an
 * array, never through a shell, so a path with spaces, backticks or `$()` stays one argument.
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function homeDirectory(): string {
  return homedir();
}

export function absolutePath(path: string): string {
  return resolve(path);
}

/** Does not return: the process exits with the new one's status. Call it once the terminal is restored. */
export async function relaunch(repoPath: string): Promise<void> {
  const standalone = Bun.isStandaloneExecutable || Bun.main.startsWith("/$bunfs/");
  const executable = standalone ? process.execPath : process.argv[0];
  const args = standalone ? [repoPath] : [process.argv[1], repoPath];
  const result = spawnSync(executable, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
