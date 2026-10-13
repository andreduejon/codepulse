import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot, createSignal } from "solid-js";
import { isUncommittedHash } from "../src/constants";
import { createAppState } from "../src/context/state";
import { runGit } from "../src/git/repo";
import { useDataLoader } from "../src/hooks/use-data-loader";

const roots: string[] = [];
const disposers: (() => void)[] = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** Temp repo on `main`; `commits` are subjects committed in order, each touching file.txt. */
async function makeRepo(commits: string[]) {
  const root = await mkdtemp(join(tmpdir(), "codepulse-loader-"));
  roots.push(root);
  const git = async (...args: string[]) => {
    const result = await runGit(root, ["-c", "user.name=T", "-c", "user.email=t@example.test", ...args]);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await git("init", "-b", "main");
  for (const subject of commits) {
    await writeFile(join(root, "file.txt"), `${subject}\n`);
    await git("add", ".");
    await git("commit", "-m", subject);
  }
  return { root, git };
}

function mount(repoPath: string, maxCount: number) {
  return createRoot(dispose => {
    disposers.push(dispose);
    const { state, actions } = createAppState(maxCount, 0, 0);
    const [path] = createSignal(repoPath);
    const loader = useDataLoader({ repoPath: path, state, actions });
    return { state, actions, loader, dispose };
  });
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

test("HEAD past the first page is still loaded, selected, and anchors the uncommitted row", async () => {
  const { root, git } = await makeRepo(["old"]);
  await git("branch", "old-release");
  for (const subject of ["n1", "n2", "n3", "n4", "n5"]) {
    await writeFile(join(root, "file.txt"), `${subject}\n`);
    await git("commit", "-am", subject);
  }
  await git("checkout", "old-release");
  await writeFile(join(root, "file.txt"), "dirty\n");
  const head = await git("rev-parse", "HEAD");

  const { state } = mount(root, 2);
  await until(() => !state.loading() && state.commits().length > 0, "load");

  const [first] = state.commits();
  expect(isUncommittedHash(first.hash)).toBe(true);
  expect(first.parents).toEqual([head]);
  expect(state.commits().some(commit => commit.hash === head)).toBe(true);
  expect([first.hash, head]).toContain(state.selectedCommit()?.hash ?? "");
});

test("disposal stops in-flight loads from writing state", async () => {
  const { root } = await makeRepo(["c1"]);
  const { state, dispose } = mount(root, 50);
  dispose();
  await Bun.sleep(300); // longer than a tiny-repo load
  expect(state.commits()).toEqual([]);
});
