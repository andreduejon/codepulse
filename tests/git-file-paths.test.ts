import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommitDetail, runGit } from "../src/git/repo";
import { getStagedFiles, getUntrackedFiles } from "../src/git/repo-status";

test("file lists use exact paths for root commits, non-ASCII and space-padded names, and staged renames", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-file-paths-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, args);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const paths = (files: { path: string; status: string }[]) => files.map(f => `${f.status} ${f.path}`).sort();
  try {
    await git("init");
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "old.txt"), "a\nb\nc\nd\n");
    await writeFile(join(root, "café.txt"), "hi\n");
    await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "initial");

    const detail = await getCommitDetail(root, await git("rev-parse", "HEAD"));
    expect(paths(detail?.files ?? [])).toEqual(["A café.txt", "A dir/old.txt"]);

    await writeFile(join(root, "naïve.md"), "x\n");
    await writeFile(join(root, " lead.txt"), "x\n");
    expect(paths(await getUntrackedFiles(root))).toEqual(["A  lead.txt", "A naïve.md"]);

    await git("mv", "dir/old.txt", "dir/new.txt");
    expect(paths(await getStagedFiles(root))).toEqual(["A dir/new.txt", "D dir/old.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
