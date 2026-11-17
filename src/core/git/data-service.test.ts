/** The Git data service without Solid: the app's state is plain objects, Git is a fake. */
import { expect, mock, test } from "bun:test";
import { createGitDataService } from "./data-service";
import type { GitPort } from "./port";
import type { Branch, Commit, GraphRow, TagInfo } from "./types";

const commit = (n: number, parents: number[] = [n + 1], refs: Commit["refs"] = []): Commit => ({
  hash: String(n).padStart(40, "0"),
  shortHash: String(n).padStart(7, "0"),
  parents: parents.map(p => String(p).padStart(40, "0")),
  subject: `Commit ${n}`,
  body: "",
  author: "Author",
  authorEmail: "author@example.com",
  authorDate: "2026-01-01T00:00:00Z",
  committer: "Author",
  committerEmail: "author@example.com",
  commitDate: "2026-01-01T00:00:00Z",
  refs,
});

/** Five commits; the newest is `main`, checked out. */
const history = [
  commit(1, [2], [{ name: "main", type: "branch", isCurrent: true }]),
  commit(2),
  commit(3),
  commit(4),
  commit(5, []),
];

function harness(pageSize = 3) {
  const app = {
    commits: [] as Commit[],
    rows: [] as GraphRow[],
    branches: [] as Branch[],
    tags: new Map<string, TagInfo>(),
    stashes: new Map<string, Commit[]>(),
    cursor: -1,
    remote: "",
    error: null as string | null,
    hasMore: true,
    fetching: false,
    rowsSet: 0,
  };
  let remote = "git@example.com:o/r.git";
  let fetchFails = false;
  const git = {
    getCommits: mock(async (_repo: string, options: { maxCount?: number; skip?: number } = {}) =>
      history.slice(options.skip ?? 0, (options.skip ?? 0) + (options.maxCount ?? history.length)),
    ),
    getBranches: async () => [],
    getCurrentBranch: async () => "main",
    getRemoteUrl: async () => remote,
    getTagDetails: async () => new Map(),
    getStashList: async () => [],
    getWorkingTreeStatus: async () => null,
    getLastFetchTime: async () => null,
    fetchRemote: async () => (fetchFails ? { ok: false, error: "The remote could not be reached" } : { ok: true }),
    fastForwardBranches: async () => ({ moved: [], skipped: [] }),
  } as unknown as GitPort;
  const service = createGitDataService({
    git,
    repoPath: () => "/repo",
    state: {
      commits: () => app.commits,
      branches: () => app.branches,
      tagDetails: () => app.tags,
      stashByParent: () => app.stashes,
      cursorIndex: () => app.cursor,
      selectedCommit: () => app.rows[app.cursor]?.commit ?? null,
      viewingBranch: () => null,
      showAllBranches: () => true,
      maxCount: () => pageSize,
      fetching: () => app.fetching,
      hasMore: () => app.hasMore,
    },
    actions: {
      setCommits: commits => {
        app.commits = commits;
      },
      setGraphRows: rows => {
        app.rows = rows;
        app.rowsSet++;
      },
      setMaxGraphColumns: () => {},
      setBranches: branches => {
        app.branches = branches;
      },
      setCurrentBranch: () => {},
      setRepoPath: () => {},
      setRemoteUrl: url => {
        app.remote = url;
      },
      setTagDetails: tags => {
        app.tags = tags;
      },
      setStashByParent: map => {
        app.stashes = map;
      },
      setCursorIndex: index => {
        app.cursor = index;
      },
      setScrollTargetIndex: () => {},
      noteWorkingTreeRead: () => {},
      setLoading: () => {},
      setError: error => {
        app.error = error;
      },
      setLastFetchTime: () => {},
      setFetching: fetching => {
        app.fetching = fetching;
      },
      setHasMore: hasMore => {
        app.hasMore = hasMore;
      },
      setHistoryError: () => {},
    },
    batch: fn => fn(),
  });
  return {
    app,
    git,
    service,
    remote: (url: string) => {
      remote = url;
    },
    failFetch: () => {
      fetchFails = true;
    },
  };
}

test("a load shows the first page with the checked-out commit selected, and pages bring the rest", async () => {
  const h = harness();
  await h.service.loadData();
  expect(h.app.commits.map(c => c.subject)).toEqual(["Commit 1", "Commit 2", "Commit 3"]);
  expect(h.app.cursor).toBe(0);
  expect(h.app.hasMore).toBe(true);
  await h.service.loadMoreData();
  expect(h.app.commits.map(c => c.subject)).toEqual(["Commit 1", "Commit 2", "Commit 3", "Commit 4", "Commit 5"]);
  expect(h.app.hasMore).toBe(false);
});

test("a quiet reload with the same commits keeps the rows and shows what changed beside them", async () => {
  const h = harness();
  await h.service.loadData();
  const rows = h.app.rows;
  h.remote("git@example.com:o/renamed.git");
  await h.service.loadData(undefined, undefined, true, true);
  expect(h.app.rows).toBe(rows);
  expect(h.app.rowsSet).toBe(1);
  expect(h.app.remote).toBe("git@example.com:o/renamed.git");
});

test("a fetch that fails says why and leaves the graph as it was", async () => {
  const h = harness();
  await h.service.loadData();
  const rows = h.app.rows;
  h.failFetch();
  await h.service.handleFetch();
  expect(h.app.error).toBe("The remote could not be reached");
  expect(h.app.rows).toBe(rows);
  expect(h.app.fetching).toBe(false);
});
