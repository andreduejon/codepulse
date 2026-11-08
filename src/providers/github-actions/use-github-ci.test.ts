import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createAppState } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { buildGraph } from "../../git/graph";
import { closeProviderCaches } from "../shared/sha-sqlite-cache";
import * as api from "./api";
import type { GitHubWorkflowRun } from "./types";
import { useGitHubCI } from "./use-github-ci";

const SHA = "e".repeat(40);
const TOKEN_ENV = "CODEPULSE_TEST_GITHUB_TOKEN";

const run = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun =>
  ({
    id: 11,
    name: "CI",
    status: "in_progress",
    conclusion: null,
    headSha: SHA,
    runNumber: 3,
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
    url: "https://github.com/o/r/actions/runs/11",
    ...overrides,
  }) as GitHubWorkflowRun;

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

const settle = async (until: () => boolean = () => true) => {
  for (let i = 0; i < 100 && !until(); i++) await Bun.sleep(5);
  await Bun.sleep(5);
};

async function mountGitHub() {
  const original = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "test-token";
  cleanup.push(() => {
    if (original === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = original;
  });
  const root = await mkdtemp(join(tmpdir(), "codepulse-github-hook-"));
  cleanup.push(async () => {
    closeProviderCaches();
    await rm(root, { recursive: true, force: true });
  });
  const ci = spyOn(api, "fetchCIDataForSHAs").mockResolvedValue({ data: [run()], jobs: new Map(), error: null });
  cleanup.push(() => ci.mockRestore());
  let mounted!: {
    state: ReturnType<typeof createAppState>["state"];
    actions: ReturnType<typeof createAppState>["actions"];
    github: ReturnType<typeof useGitHubCI>;
  };
  createRoot(dispose => {
    cleanup.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath("/repo/github-hook");
    actions.setRemoteUrl("https://github.com/o/r.git");
    actions.setActiveProviderView("github-actions");
    actions.setGraphRows(
      buildGraph([
        {
          hash: SHA,
          shortHash: SHA.slice(0, 7),
          parents: [],
          subject: "ci",
          body: "",
          author: "Author",
          authorEmail: "author@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          committer: "Author",
          committerEmail: "author@example.com",
          commitDate: "2026-01-01T00:00:00Z",
          refs: [],
        },
      ]),
    );
    const github = useGitHubCI({
      state,
      actions,
      cacheRoot: root,
      config: { enabled: true, tokenEnvVar: TOKEN_ENV, autoRefreshSeconds: 0 },
    });
    mounted = { state, actions, github };
  });
  return { ...mounted, ci };
}

test("a failed refresh of running runs shows its error, like Jenkins, instead of only reaching Debug", async () => {
  const { github, state, actions, ci } = await mountGitHub();
  await github.refresh();
  await settle(() => state.graphBadges().size > 0);
  expect(state.providerStatusFor("github-actions").kind).toBe("idle");
  ci.mockResolvedValue({ data: [], jobs: new Map(), error: BANNER.github.fetchFailed });
  // Re-enter the view after the stale threshold: the running SHA is refreshed automatically.
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  try {
    const calls = ci.mock.calls.length;
    actions.setActiveProviderView("git");
    actions.setActiveProviderView("github-actions");
    await settle(() => ci.mock.calls.length > calls);
    await settle(() => state.providerStatusFor("github-actions").kind === "error");
    expect(state.providerStatusFor("github-actions")).toEqual({ kind: "error", message: BANNER.github.fetchFailed });
  } finally {
    clock.mockRestore();
  }
});

test("entering the GitHub view before the remote is known fetches once the remote arrives, without a stale banner", async () => {
  const { state, actions, ci } = await mountGitHub();
  await settle(() => ci.mock.calls.length > 0);
  const calls = ci.mock.calls.length;
  // Like a repository switch while in the GitHub view: no remote yet, then the loader sets it.
  actions.setRemoteUrl("");
  actions.setRepoPath("/repo/github-hook-2");
  await settle();
  actions.setRemoteUrl("https://github.com/o/r2.git");
  await settle(() => ci.mock.calls.length > calls);
  expect(ci.mock.calls.length).toBeGreaterThan(calls);
  await settle(() => state.providerStatusFor("github-actions").kind !== "unavailable");
  expect(state.providerStatusFor("github-actions").kind).not.toBe("unavailable");
});
