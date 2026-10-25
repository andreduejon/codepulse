import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot, createSignal } from "solid-js";
import type { DetailNavRef } from "../src/components/detail-types";
import { isUncommittedHash } from "../src/constants";
import { createAppState } from "../src/context/state";
import { runGit } from "../src/git/repo";
import { useDataLoader } from "../src/hooks/use-data-loader";
import { useDetailLoader } from "../src/hooks/use-detail-loader";

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

function mount(repoPath: string, maxCount: number, withDetail = false, getCommitData?: (sha: string) => unknown) {
  return createRoot(dispose => {
    disposers.push(dispose);
    const { state, actions } = createAppState(maxCount, 0, 0);
    const [path, setPath] = createSignal(repoPath);
    const loader = useDataLoader({ repoPath: path, state, actions });
    if (withDetail) {
      useDetailLoader({
        repoPath: path,
        state,
        actions,
        getIsJumpNavigation: () => false,
        detailNavRef: { pendingJumpDirection: null } as DetailNavRef,
        getCommitData,
      });
    }
    return { state, actions, loader, setPath, dispose };
  });
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

const subjects = (commits: { subject: string }[]) => commits.map(commit => commit.subject);

test("pages through history to the end and keeps the cursor on the selected commit", async () => {
  const { root } = await makeRepo(["c1", "c2", "c3", "c4", "c5"]);
  const { state, actions, loader } = mount(root, 2);
  await until(() => !state.loading() && state.commits().length > 0, "first page");

  expect(subjects(state.commits())).toEqual(["c5", "c4"]);
  expect(state.hasMore()).toBe(true);
  expect(state.currentBranch()).toBe("main");
  expect(state.selectedCommit()?.subject).toBe("c5");

  actions.setCursorIndex(1);
  await loader.loadMoreData();
  expect(subjects(state.commits())).toEqual(["c5", "c4", "c3", "c2"]);
  expect(state.selectedCommit()?.subject).toBe("c4");

  await loader.loadMoreData();
  expect(subjects(state.commits())).toEqual(["c5", "c4", "c3", "c2", "c1"]);
  expect(state.hasMore()).toBe(false);
  await loader.loadMoreData();
  expect(state.commits()).toHaveLength(5);
  expect(state.fetching()).toBe(false);
});

test("switching repositories discards the previous repository's load", async () => {
  const first = await makeRepo(["a1", "a2", "a3"]);
  const second = await makeRepo(["b1"]);
  const { state, setPath } = mount(first.root, 50);
  setPath(second.root);
  await until(() => !state.loading() && state.commits().length > 0, "second repository");
  await Bun.sleep(100); // give a stale first-repo result time to land, if it were not discarded
  expect(subjects(state.commits())).toEqual(["b1"]);
  expect(state.repoPath()).toBe(second.root);
});

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
  const spawn = spyOn(Bun, "spawn");
  try {
    const { state, dispose } = mount(root, 50);
    expect(spawn).toHaveBeenCalled();
    dispose();
    // Wait for Git and Windows taskkill to release the temp repo before cleanup.
    await Promise.all(spawn.mock.results.map(result => (result.value as ReturnType<typeof Bun.spawn>).exited));
    await Bun.sleep(0);
    expect(state.commits()).toEqual([]);
  } finally {
    spawn.mockRestore();
  }
});

test("detail loader shows the selected commit's files, merge files, and uncommitted changes", async () => {
  const { root, git } = await makeRepo(["base"]);
  await git("checkout", "-b", "side");
  await writeFile(join(root, "side.txt"), "side\n");
  await git("add", ".");
  await git("commit", "-m", "side");
  await git("checkout", "main");
  await git("merge", "--no-ff", "side", "-m", "merge side");
  await writeFile(join(root, "file.txt"), "dirty\n");

  const { state, actions } = mount(root, 50, true);
  await until(() => !state.loading() && state.commits().length > 0, "load");
  const rowOf = (subject: string) => state.graphRows().findIndex(row => row.commit.subject === subject);
  const files = () => state.commitDetail()?.files.map(file => file.path) ?? [];

  actions.setCursorIndex(state.graphRows().findIndex(row => isUncommittedHash(row.commit.hash)));
  await until(() => state.uncommittedDetail() !== null, "uncommitted detail");
  expect(state.uncommittedDetail()?.unstaged.map(file => file.path)).toEqual(["file.txt"]);

  // Rapid navigation: only the last selection's detail may land.
  actions.setCursorIndex(rowOf("base"));
  actions.setCursorIndex(rowOf("merge side"));
  await until(() => !state.detailLoading() && state.commitDetail() !== null, "merge detail");
  expect(state.commitDetail()?.subject).toBe("merge side");
  expect(files()).toEqual(["side.txt"]);

  actions.setCursorIndex(rowOf("base"));
  await until(() => state.commitDetail()?.subject === "base", "root detail");
  expect(files()).toEqual(["file.txt"]);
});

test("switching from Git stashes to a provider selects its detail tab and resets the cursor", async () => {
  const { root } = await makeRepo(["base"]);
  const { state, actions } = mount(root, 50, true);
  await until(() => !state.detailLoading() && state.commitDetail() !== null, "commit detail");
  const selected = state.selectedCommit();
  if (!selected) throw new Error("Missing selected commit");
  actions.setStashByParent(new Map([[selected.hash, [{ ...selected, hash: "stash", parents: [selected.hash] }]]]));

  for (const provider of ["github-actions", "jenkins", "openshift", "snyk"] as const) {
    actions.setActiveProviderView("git");
    actions.setDetailActiveTab("stashes");
    actions.setDetailCursorIndex(3);
    actions.setActiveProviderView(provider);

    expect(state.detailActiveTab()).toBe(provider);
    expect(state.detailCursorIndex()).toBe(0);
    expect(state.detailLoading()).toBe(false);
  }
});

test("Dependencies stays available without cached coverage and falls back only when leaving Snyk", async () => {
  const { root } = await makeRepo(["base"]);
  const [projects, setProjects] = createSignal<unknown[]>([{ status: "skipped" }]);
  const { state, actions } = mount(root, 50, true, () => ({ dependencyProjects: projects() }));
  await until(() => !state.detailLoading() && state.commitDetail() !== null, "commit detail");
  actions.setActiveProviderView("snyk");
  actions.setDetailActiveTab("snyk-deps");
  actions.setDetailCursorIndex(3);
  expect(state.detailActiveTab()).toBe("snyk-deps");

  setProjects([]);
  expect(state.detailActiveTab()).toBe("snyk-deps");

  setProjects([{ status: "failed" }]);
  actions.setDetailActiveTab("snyk-deps");
  expect(state.detailActiveTab()).toBe("snyk-deps");
  actions.setActiveProviderView("jenkins");
  expect(state.detailActiveTab()).toBe("jenkins");
});
