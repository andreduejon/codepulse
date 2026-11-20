import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchPullRequest, getCommitDetail, runGit } from "../src/adapters/git/repo";
import { getFileBlame, getFileContent, getFileDiff } from "../src/adapters/git/repo-diff";
import { getRangeFiles, getStagedFiles, getStashFiles, getUntrackedFiles } from "../src/adapters/git/repo-status";

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

test("a pull request's files and diff are its branch's since it left the target, not what the target did since", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-range-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init", "-b", "main");
    await writeFile(join(root, "shared.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-m", "initial");
    const left = await git("rev-parse", "HEAD");
    await git("checkout", "-b", "feature");
    await writeFile(join(root, "shared.txt"), "one\ntwo\n");
    await writeFile(join(root, "feature.txt"), "new\n");
    await git("add", ".");
    await git("commit", "-m", "feature");
    const head = await git("rev-parse", "HEAD");
    await git("checkout", "main");
    await writeFile(join(root, "main-only.txt"), "later\n");
    await git("add", ".");
    await git("commit", "-m", "main moves on");

    const range = await getRangeFiles(root, "main", head);
    expect(range?.mergeBase).toBe(left);
    expect(paths(range?.files ?? [])).toEqual(["A feature.txt", "M shared.txt"]);
    const diff = await getFileDiff(root, head, "shared.txt", "range", undefined, range?.mergeBase);
    expect(diff.hunks.flatMap(hunk => hunk.lines.map(line => `${line.type} ${line.content}`))).toEqual([
      "context one",
      "add two",
    ]);
    // A commit Git hasn't, or a name that would be an option: nothing.
    expect(await getRangeFiles(root, "main", "f".repeat(40))).toBeNull();
    expect(await getRangeFiles(root, "--all", head)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pull request's renamed file is its old path gone and its new one added; a shallow clone has no merge base", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-range-edges-"));
  const repo = join(root, "repo");
  const shallow = join(root, "shallow");
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await mkdir(repo);
    await git(repo, "init", "-b", "main");
    await writeFile(join(repo, "old.txt"), "one\ntwo\nthree\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "initial");
    await git(repo, "checkout", "-b", "feature");
    await git(repo, "mv", "old.txt", "new.txt");
    await git(repo, "commit", "-m", "rename");
    const head = await git(repo, "rev-parse", "HEAD");
    const range = await getRangeFiles(repo, "main", head);
    // Each path the diff dialog can open: the old one's deletion, the new one's addition.
    expect(paths(range?.files ?? [])).toEqual(["A new.txt", "D old.txt"]);

    // A clone of the branch's tip alone: Git can't tell where it left main.
    await git(root, "clone", "-q", "--depth", "1", "--branch", "feature", pathToFileURL(repo).href, "shallow");
    await git(shallow, "fetch", "-q", "--depth", "1", "origin", "main:refs/remotes/origin/main");
    expect(await getRangeFiles(shallow, "origin/main", head)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Windows can't name a file with a tab, a newline or a quote.
test.skipIf(process.platform === "win32")(
  "a name with a tab, a newline or a quote is listed exactly and its diff opens; a failed read is an error",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "codepulse-git-odd-names-"));
    const git = async (...args: string[]) => {
      const result = await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    try {
      await git("init");
      // And names Git would read as a pattern: magic and a wildcard.
      const names = ["tab\there.txt", "new\nline.txt", 'say "hi".txt', ":(top)magic.txt", "star*.txt"];
      for (const name of names) await writeFile(join(root, name), "one\n");
      await git("add", ".");
      await git("commit", "-m", "odd names");
      const head = await git("rev-parse", "HEAD");
      const detail = await getCommitDetail(root, head);
      expect(paths(detail?.files ?? [])).toEqual(names.map(name => `A ${name}`).sort());
      for (const name of names) expect((await getFileDiff(root, head, name, "commit")).hunks).toHaveLength(1);

      const missing = "0123456789abcdef0123456789abcdef01234567";
      await expect(getFileDiff(root, missing, names[0], "range", undefined, head)).rejects.toThrow();
      await expect(getCommitDetail(root, missing, detail ?? undefined)).rejects.toThrow();
      await expect(getFileContent(root, missing, names[0], "commit")).rejects.toThrow();
      // A file HEAD hasn't (a new one) has no blame, and that is no error.
      await writeFile(join(root, "new.txt"), "new\n");
      expect(await getFileBlame(root, head, "new.txt", "unstaged")).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("a stash's untracked files (git stash -u) are listed as added, and their diff and content open", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-stash-untracked-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init");
    await writeFile(join(root, "tracked.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-m", "initial");
    await writeFile(join(root, "untracked.txt"), "new\n");
    await git("stash", "push", "-u");
    const stash = await git("rev-parse", "stash@{0}");
    expect(paths(await getStashFiles(root, stash))).toEqual(["A untracked.txt"]);
    expect((await getFileDiff(root, stash, "untracked.txt", "stash")).hunks).toHaveLength(1);
    expect((await getFileContent(root, stash, "untracked.txt", "stash")).lines).toHaveLength(1);

    // A stash without -u has no third parent: no error.
    await writeFile(join(root, "tracked.txt"), "two\n");
    await git("stash", "push");
    const plain = await git("rev-parse", "stash@{0}");
    expect(paths(await getStashFiles(root, plain))).toEqual(["M tracked.txt"]);

    // The third parent's tree unreadable: an error, not an empty stash.
    const tree = await git("rev-parse", `${stash}^3^{tree}`);
    await rm(join(root, ".git", "objects", tree.slice(0, 2), tree.slice(2)), { force: true });
    await expect(getStashFiles(root, stash)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pull request's commits are fetched alone: its head from refs/pull/N/head and its target branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-fetch-pull-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const clone = join(root, "clone");
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await mkdir(work);
    await git(root, "init", "-q", "--bare", "-b", "main", remote);
    await git(work, "init", "-q", "-b", "main");
    await writeFile(join(work, "a.txt"), "a\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "a");
    await git(work, "push", "-q", pathToFileURL(remote).href, "main");
    await git(root, "clone", "-q", pathToFileURL(remote).href, "clone");
    // After the clone: a fork's pull request (only under refs/pull) and a new target branch.
    await git(work, "checkout", "-q", "-b", "staging");
    await writeFile(join(work, "s.txt"), "s\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "staging");
    await git(work, "push", "-q", pathToFileURL(remote).href, "staging");
    await git(work, "checkout", "-q", "-b", "fork", "main");
    await writeFile(join(work, "f.txt"), "f\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "fork");
    const head = await git(work, "rev-parse", "HEAD");
    await git(work, "push", "-q", pathToFileURL(remote).href, "HEAD:refs/pull/7/head");

    expect(await getRangeFiles(clone, "origin/staging", head)).toBeNull();
    expect(await fetchPullRequest(clone, 7, "staging")).toBe(true);
    expect(paths((await getRangeFiles(clone, "origin/staging", head))?.files ?? [])).toEqual(["A f.txt"]);
    // No local branch moved or appeared.
    expect(await git(clone, "branch", "--format=%(refname:short)")).toBe("main");
    // A name that isn't a branch name never reaches the refspec; the head still arrives.
    expect(await fetchPullRequest(clone, 7, "bad..name")).toBe(true);
    // Only one of the two arriving is not fetched: the next read tries again.
    expect(await fetchPullRequest(clone, 8, "staging")).toBe(false);
    expect(await fetchPullRequest(clone, 7, "gone")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Windows has no chmod 000, and root reads anything.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "an untracked file that can't be read is an error, not a file without changes",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "codepulse-git-unreadable-"));
    try {
      await runGit(root, ["init", "-q"]);
      await writeFile(join(root, "secret.txt"), "x\n");
      await chmod(join(root, "secret.txt"), 0o000);
      await expect(getFileDiff(root, "", "secret.txt", "untracked")).rejects.toThrow();
    } finally {
      await chmod(join(root, "secret.txt"), 0o644).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);
