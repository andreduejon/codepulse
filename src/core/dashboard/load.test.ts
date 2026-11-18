/** The Dashboard's reading without Git or caches: the branch walk and the events come from fakes. */
import { expect, test } from "bun:test";
import { githubEvents } from "../github/events";
import type { GitHubCacheEntry } from "../github/merge";
import { branchOwners, type DashboardGit, type DashboardSources, readAppEvents } from "./load";

// main: m3 → m2 → m1; develop branched at m1: d2 → d1 → m1, merged into main at m3 (m3's second parent is d2).
const walk = {
  firstParent: new Map<string, string | undefined>([
    ["m3", "m2"],
    ["m2", "m1"],
    ["m1", undefined],
    ["d2", "d1"],
    ["d1", "m1"],
  ]),
  tips: [
    { sha: "m3", name: "main", refname: "refs/remotes/origin/main" },
    { sha: "d2", name: "develop", refname: "refs/remotes/origin/develop" },
  ],
};

test("main owns its own line; a commit merged into it from develop stays develop's", () => {
  const owners = branchOwners(new Set(["m2", "d1", "x"]), walk, { name: "main", tip: "m3" });
  expect(owners).toEqual(
    new Map([
      ["m2", "main"],
      ["d1", "develop"],
    ]),
  );
});

test("an app's events: main's commits with its name, and a run's commit named by the branch walk", async () => {
  const git: DashboardGit = {
    getMainBranch: async () => ({ ref: "origin/main", name: "main" }),
    getMainBranchCommits: async () => [{ hash: "m3", time: 2_000, subject: "Merge develop" }],
    getBranchWalk: async () => walk,
    resolveCommit: async () => "",
  };
  const run = {
    sha: "d1",
    runs: [
      {
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "failure",
        headSha: "d1",
        startedAt: "1970-01-01T00:00:01Z",
        updatedAt: "1970-01-01T00:00:03Z",
        runNumber: 1,
        url: "",
      },
    ],
  } as unknown as GitHubCacheEntry;
  const sources: DashboardSources = [async app => githubEvents(app, [run])];
  const events = await readAppEvents("/repo", { since: 0 }, { git, sources });
  expect(events.map(event => [event.source, event.sha, event.branch])).toEqual([
    ["git", "m3", "main"],
    ["github-actions", "d1", "develop"],
  ]);
});
