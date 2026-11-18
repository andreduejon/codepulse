/** The selected commit's details without Solid: Git is a fake, the timer runs when the test says. */
import { expect, test } from "bun:test";
import { createCommitDetailService } from "./commit-detail";
import type { GitPort } from "./port";
import type { Commit, CommitDetail, UncommittedDetail } from "./types";
import { UNCOMMITTED_HASH } from "./types";

const commit = (hash: string): Commit =>
  ({ hash, shortHash: hash.slice(0, 7), parents: [], subject: hash, refs: [] }) as unknown as Commit;

function harness() {
  const shown = { detail: null as CommitDetail | null, uncommitted: null as UncommittedDetail | null, loading: false };
  const timers: (() => void)[] = [];
  const answers = new Map<string, (detail: CommitDetail) => void>();
  const git = {
    getCommitDetail: (_repo: string, hash: string, existing: Commit) =>
      new Promise<CommitDetail>(resolve => answers.set(hash, () => resolve({ ...existing, files: [] }))),
    getUncommittedDetail: async () => ({
      staged: [{ path: "a.ts" }],
      unstaged: [],
      untracked: [{ path: "b.ts" }],
    }),
  } as unknown as GitPort;
  let selected: string | undefined;
  const service = createCommitDetailService({
    git,
    repoPath: () => "/repo",
    selectedHash: () => selected,
    actions: {
      setCommitDetail: detail => {
        shown.detail = detail;
      },
      setUncommittedDetail: detail => {
        shown.uncommitted = detail;
      },
      setDetailLoading: loading => {
        shown.loading = loading;
      },
      setError: () => {},
    },
    setTimeout: fn => timers.push(fn),
    clearTimeout: () => timers.pop(),
  });
  const select = (hash: string | null) => {
    selected = hash ?? undefined;
    service.select(hash ? commit(hash) : null);
  };
  const rest = () => {
    for (const run of timers.splice(0)) run();
  };
  return { shown, select, rest, answer: (hash: string) => answers.get(hash)?.({} as CommitDetail), service };
}

test("the details are read once the cursor rests, and a newer selection drops the older read", async () => {
  const h = harness();
  h.select("a");
  expect(h.shown.loading).toBe(true);
  h.rest();
  h.select("b");
  h.rest();
  h.answer("a");
  h.answer("b");
  await Bun.sleep(0);
  expect(h.shown.detail?.hash).toBe("b");
  expect(h.shown.loading).toBe(false);
});

test("the Uncommitted row shows the working tree's files, and a refresh reads them again quietly", async () => {
  const h = harness();
  h.select(UNCOMMITTED_HASH);
  h.rest();
  await Bun.sleep(0);
  expect(h.shown.detail?.files.map(file => file.path)).toEqual(["a.ts", "b.ts"]);
  h.shown.detail = null;
  h.service.reloadWorkingTree(commit(UNCOMMITTED_HASH));
  await Bun.sleep(0);
  expect((h.shown.detail as CommitDetail | null)?.files).toHaveLength(2);
  expect(h.shown.loading).toBe(false);
});

test("no selection shows no details", () => {
  const h = harness();
  h.select(null);
  expect(h.shown.detail).toBeNull();
  expect(h.shown.loading).toBe(false);
});
