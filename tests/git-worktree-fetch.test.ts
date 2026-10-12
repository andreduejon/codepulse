import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getLastFetchTime, runGit } from "../src/git/repo";

test("last fetch time handles absolute linked-worktree Git directory and spaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse git paths "));
  try {
    const git = async (args: string[]) => {
      const result = await runGit(root, args);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    await git(["init"]);
    await git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ]);
    const worktree = join(root, "linked worktree");
    await git(["worktree", "add", "--detach", worktree, "HEAD"]);
    const { stdout } = await runGit(worktree, ["rev-parse", "--git-dir"]);
    await writeFile(resolve(worktree, stdout.trim(), "FETCH_HEAD"), "test fetch\n");
    expect(await getLastFetchTime(worktree)).toBeInstanceOf(Date);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
