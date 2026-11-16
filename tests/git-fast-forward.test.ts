import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot, createSignal } from "solid-js";
import { createAppState } from "../src/context/state";
import { type FastForwardResult, fastForwardBranches, runGit } from "../src/git/repo";
import { useDataLoader } from "../src/hooks/use-data-loader";

const roots: string[] = [];
const disposers: (() => void)[] = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, ["-c", "user.name=T", "-c", "user.email=t@example.test", ...args]);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

async function commit(cwd: string, subject: string, file = "file.txt") {
  await writeFile(join(cwd, file), `${subject}\n`);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", subject);
}

/**
 * An origin with `main` and `dev`, the clone codepulse shows (on `main`, with `dev` tracking `origin/dev`), and another
 * clone that pushes, like a pull request merged on GitHub.
 */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "codepulse-ff-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const local = join(root, "local");
  const other = join(root, "other");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "clone", origin, other);
  await git(other, "checkout", "-b", "main");
  await commit(other, "initial");
  await git(other, "push", "-u", "origin", "main");
  await git(other, "push", "origin", "main:dev");
  await git(root, "clone", origin, local);
  await git(local, "branch", "--track", "dev", "origin/dev");
  /** Pushes commits from the other clone (each `subject` or `[subject, file]`), then fetches in the local one. */
  const push = async (branch: string, ...commits: (string | [string, string])[]) => {
    await git(other, "checkout", "-B", branch, `origin/${branch}`);
    for (const entry of commits) {
      const [subject, file] = typeof entry === "string" ? [entry, undefined] : entry;
      await commit(other, subject, file);
    }
    await git(other, "push", "origin", branch);
    await git(local, "fetch", "--all", "--prune");
  };
  const head = (branch: string) => git(local, "rev-parse", branch);
  return { root, local, push, head };
}

test("moves the checked-out branch and the other branches that are only behind their remote branch", async () => {
  const { local, push, head } = await setup();
  await push("main", "merge pull request 1", "merge pull request 2");
  await push("dev", "dev work");

  expect(await fastForwardBranches(local)).toEqual({
    moved: [
      { branch: "dev", commits: 1 },
      { branch: "main", commits: 2 },
    ],
    skipped: [],
  });
  expect(await head("main")).toBe(await head("origin/main"));
  expect(await head("dev")).toBe(await head("origin/dev"));
  // The checked-out branch's files follow it.
  // Line endings as checked out: Git for Windows writes CRLF (core.autocrlf).
  expect((await readFile(join(local, "file.txt"), "utf-8")).replace(/\r\n/g, "\n")).toBe("merge pull request 2\n");
  expect(await git(local, "status", "--porcelain")).toBe("");
});

test("nothing to do when every branch is up to date or only ahead", async () => {
  const { local } = await setup();
  await commit(local, "not pushed yet");
  expect(await fastForwardBranches(local)).toEqual({ moved: [], skipped: [] });
});

test("leaves the checked-out branch alone while the working tree has changes", async () => {
  const { local, push, head } = await setup();
  await push("main", "merged");
  const before = await head("main");
  await writeFile(join(local, "file.txt"), "editing\n");

  expect(await fastForwardBranches(local)).toEqual({
    moved: [],
    skipped: [{ branch: "main", reason: "local-changes" }],
  });
  expect(await head("main")).toBe(before);
  expect(await readFile(join(local, "file.txt"), "utf-8")).toBe("editing\n");
});

test("an untracked file alone does not stop it, unless Git would overwrite it", async () => {
  const { local, push, head } = await setup();
  await push("main", "merged");
  await writeFile(join(local, "notes.txt"), "mine\n");
  expect((await fastForwardBranches(local)).moved).toEqual([{ branch: "main", commits: 1 }]);
  expect(await readFile(join(local, "notes.txt"), "utf-8")).toBe("mine\n");

  await push("main", ["adds new.txt", "new.txt"]);
  await writeFile(join(local, "new.txt"), "local copy\n");
  const before = await head("main");
  const result = await fastForwardBranches(local);
  expect(result.moved).toEqual([]);
  expect(result.skipped).toEqual([{ branch: "main", reason: "untracked", files: ["new.txt"] }]);
  expect(await head("main")).toBe(before);
  expect(await readFile(join(local, "new.txt"), "utf-8")).toBe("local copy\n");
});

test("an ignored local file the remote starts tracking is never overwritten: main stays, and the message names it", async () => {
  const { root, local, head } = await setup();
  const other = join(root, "other");
  // origin ignores .env; the local clone has one with its own secrets.
  await git(other, "checkout", "-B", "main", "origin/main");
  await writeFile(join(other, ".gitignore"), ".env\n");
  await git(other, "add", ".gitignore");
  await git(other, "commit", "-m", "ignore .env");
  await git(other, "push", "origin", "main");
  await git(local, "pull", "--ff-only", "-q");
  await writeFile(join(local, ".env"), "SECRET=local\n");
  const before = await head("main");
  // Then someone commits a .env anyway (git add -f).
  await writeFile(join(other, ".env"), "SECRET=example\n");
  await git(other, "add", "-f", ".env");
  await git(other, "commit", "-m", "track .env");
  await git(other, "push", "origin", "main");
  await git(local, "fetch", "-q");

  const result = await fastForwardBranches(local);
  expect(result.moved).toEqual([]);
  expect(result.skipped).toEqual([{ branch: "main", reason: "untracked", files: [".env"] }]);
  expect(await head("main")).toBe(before);
  expect(await readFile(join(local, ".env"), "utf-8")).toBe("SECRET=local\n");
});

test("never moves a branch with commits of its own, or one checked out in another worktree", async () => {
  const { root, local, push, head } = await setup();
  await commit(local, "local only");
  await push("main", "merged");
  await push("dev", "dev work");
  const devBefore = await head("dev");
  await git(local, "worktree", "add", join(root, "dev-worktree"), "dev");
  const mainBefore = await head("main");

  expect(await fastForwardBranches(local)).toEqual({
    moved: [],
    skipped: [
      { branch: "dev", reason: "other-worktree" },
      { branch: "main", reason: "diverged" },
    ],
  });
  expect(await head("main")).toBe(mainBefore);
  expect(await head("dev")).toBe(devBefore);
});

/** The data loader on the local clone, with Auto fast-forward set to `fastForward`. */
function mount(repoPath: string, fastForward: boolean) {
  return createRoot(dispose => {
    disposers.push(dispose);
    const { state, actions } = createAppState(50, 0, 0);
    const reports: { result: FastForwardResult; explicit: boolean }[] = [];
    const [enabled, setEnabled] = createSignal(fastForward);
    const loader = useDataLoader({
      repoPath: () => repoPath,
      state,
      actions,
      autoFastForward: enabled,
      onFastForward: (result, explicit) => reports.push({ result, explicit }),
    });
    return { state, loader, reports, setEnabled };
  });
}

test("f only fetches unless Auto fast-forward is on; ctrl+f always fast-forwards and reports it", async () => {
  const { local, push, head } = await setup();
  const app = mount(local, false);
  await push("main", "merged on GitHub");
  // push() fetched already: origin/main goes back, so the fetch below is what brings the merge.
  await git(local, "update-ref", "refs/remotes/origin/main", "HEAD");
  const before = await head("main");

  // f: fetches, and main stays (codepulse doesn't change the repository unless asked).
  await app.loader.handleFetch();
  expect(await head("origin/main")).not.toBe(before);
  expect(await head("main")).toBe(before);
  expect(app.reports).toEqual([]);

  // ctrl+f: main follows, the graph shows the merge, and it says so.
  await app.loader.handleFetch("pull");
  expect(await head("main")).toBe(await head("origin/main"));
  expect(app.state.commits()[0]?.subject).toBe("merged on GitHub");
  expect(app.reports).toEqual([{ result: { moved: [{ branch: "main", commits: 1 }], skipped: [] }, explicit: true }]);

  // With the setting on, f fast-forwards too, as Auto fetch does.
  app.setEnabled(true);
  await push("main", "merged again");
  await git(local, "update-ref", "refs/remotes/origin/main", "main");
  await app.loader.handleFetch();
  expect(await head("main")).toBe(await head("origin/main"));
  expect(app.reports.at(-1)).toEqual({
    result: { moved: [{ branch: "main", commits: 1 }], skipped: [] },
    explicit: false,
  });
});
