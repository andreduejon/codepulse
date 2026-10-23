import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommits, getPathMatchingHashes, runGit } from "../src/git/repo";

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "codepulse all branches "));
  const git = async (...args: string[]) => {
    const result = await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  await git("init", "-b", "main");
  return { root, git };
}

test("all branches skip tool refs and stash internals but keep branches, tags and a detached HEAD", async () => {
  const { root, git } = await repo();
  try {
    await writeFile(join(root, "file.txt"), "one\n");
    await git("add", "file.txt");
    await git("commit", "-m", "main commit");
    await git("checkout", "-b", "feature");
    await git("commit", "--allow-empty", "-m", "feature commit");
    await git("tag", "v1");
    await git("checkout", "main");
    // A T3-style checkpoint: a commit only a private ref points to.
    const tree = await git("rev-parse", "HEAD^{tree}");
    const checkpoint = await git("commit-tree", tree, "-p", "HEAD", "-m", "t3 checkpoint");
    await git("update-ref", "refs/t3/orchestration-v2/checkpoints/thread/ordinal/1", checkpoint);
    await writeFile(join(root, "file.txt"), "stashed\n");
    await git("stash");
    await git("checkout", "--detach");
    await git("commit", "--allow-empty", "-m", "detached commit");

    const subjects = (await getCommits(root, { all: true })).map(commit => commit.subject);
    expect(subjects).toEqual(expect.arrayContaining(["detached commit", "feature commit", "main commit"]));
    expect(subjects).not.toContain("t3 checkpoint");
    expect(subjects.some(subject => subject.includes("WIP on") || subject.startsWith("index on"))).toBe(false);
    expect(await getPathMatchingHashes(root, "file.txt", { all: true })).not.toContain(checkpoint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all branches load an empty repository and a file named HEAD", async () => {
  const { root, git } = await repo();
  try {
    expect(await getCommits(root, { all: true })).toEqual([]);
    await writeFile(join(root, "HEAD"), "not a revision\n");
    await git("add", "HEAD");
    await git("commit", "-m", "adds HEAD file");
    expect((await getCommits(root, { all: true })).map(commit => commit.subject)).toEqual(["adds HEAD file"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
