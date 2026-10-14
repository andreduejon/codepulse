import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommitDetail, runGit } from "../src/git/repo";
import { getFileDiff } from "../src/git/repo-diff";
import { getStagedFiles, getUntrackedFiles } from "../src/git/repo-status";

const paths = (files: { path: string; status: string }[]) => files.map(f => `${f.status} ${f.path}`).sort();

test("file lists use exact paths for root commits, non-ASCII and space-padded names, and staged renames", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-file-paths-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, args);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init");
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "old.txt"), "a\nb\nc\nd\n");
    await writeFile(join(root, "café.txt"), "hi\n");
    await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "initial");

    const rootCommit = await git("rev-parse", "HEAD");
    const detail = await getCommitDetail(root, rootCommit);
    expect(paths(detail?.files ?? [])).toEqual(["A café.txt", "A dir/old.txt"]);
    const rootDiff = await getFileDiff(root, rootCommit, "café.txt", "commit");
    expect(rootDiff.hunks[0]?.lines.map(line => `${line.type} ${line.content}`)).toEqual(["add hi"]);

    await writeFile(join(root, "naïve.md"), "x\n");
    await writeFile(join(root, " lead.txt"), "x\n");
    expect(paths(await getUntrackedFiles(root))).toEqual(["A  lead.txt", "A naïve.md"]);

    await git("mv", "dir/old.txt", "dir/new.txt");
    expect(paths(await getStagedFiles(root))).toEqual(["A dir/new.txt", "D dir/old.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge commits list and diff their files against the first parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-merge-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init", "-b", "main");
    await writeFile(join(root, "base.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "base");
    await git("checkout", "-b", "side");
    await writeFile(join(root, "side.txt"), "side\n");
    await git("add", ".");
    await git("commit", "-m", "side");
    await git("checkout", "main");
    await git("merge", "--no-ff", "side", "-m", "merge side");
    const merge = await git("rev-parse", "HEAD");

    // Without a known commit the parents are looked up; both paths must agree.
    const detail = await getCommitDetail(root, merge);
    expect(detail?.parents).toHaveLength(2);
    expect(paths(detail?.files ?? [])).toEqual(["A side.txt"]);
    expect(paths((await getCommitDetail(root, merge, detail ?? undefined))?.files ?? [])).toEqual(["A side.txt"]);

    const diff = await getFileDiff(root, merge, "side.txt", "commit");
    expect(diff.hunks[0]?.lines.map(line => `${line.type} ${line.content}`)).toEqual(["add side"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
