import { describe, expect, test } from "bun:test";
import { groupMembersForRepo, nextGroupRepoPath, repoDisplayName } from "../src/utils/group-repos";

describe("group repos", () => {
  const repos = [
    { path: "/repo/backend", group: "e-ant", appName: "Backend" },
    { path: "/repo/frontend", group: "e-ant", appName: "Frontend" },
    { path: "/repo/api", group: "platform", appName: "API" },
  ];

  test("returns sorted group members", () => {
    expect(groupMembersForRepo(repos, "/repo/frontend").map(repo => repo.path)).toEqual(["/repo/backend", "/repo/frontend"]);
  });

  test("wraps next and previous group repo", () => {
    expect(nextGroupRepoPath(repos, "/repo/frontend", 1)).toBe("/repo/backend");
    expect(nextGroupRepoPath(repos, "/repo/backend", -1)).toBe("/repo/frontend");
  });

  test("returns null when repo has no sibling", () => {
    expect(nextGroupRepoPath(repos, "/repo/api", 1)).toBeNull();
  });

  test("uses current repo metadata even when current repo missing from known list", () => {
    expect(
      groupMembersForRepo([{ path: "/repo/backend", group: "e-ant", appName: "Backend" }], "/repo/frontend", {
        group: "e-ant",
        appName: "Frontend",
      }).map(repo => repo.path),
    ).toEqual(["/repo/backend", "/repo/frontend"]);
  });

  test("falls back display name to basename", () => {
    expect(repoDisplayName({ path: "/repo/plain" })).toBe("plain");
  });
});
