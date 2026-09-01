import { describe, expect, test } from "bun:test";
import { UNCOMMITTED_HASH } from "../src/constants";
import type { Commit } from "../src/git/types";
import type { ProviderView } from "../src/providers/provider";
import { getDefaultDetailTab, getUncommittedProviderNotice } from "../src/utils/tab-utils";

function commit(hash: string): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    subject: "subject",
    body: "",
    author: "author",
    authorEmail: "author@example.com",
    authorDate: "2026-01-01T00:00:00Z",
    committer: "committer",
    committerEmail: "committer@example.com",
    commitDate: "2026-01-01T00:00:00Z",
    refs: [],
  };
}

describe("getDefaultDetailTab", () => {
  test("keeps uncommitted changes on unstaged in provider views", () => {
    const uncommitted = commit(UNCOMMITTED_HASH);
    const providerViews: ProviderView[] = ["github-actions", "jenkins", "openshift", "snyk"];

    for (const providerView of providerViews) {
      expect(getDefaultDetailTab(uncommitted, providerView)).toBe("unstaged");
    }
  });

  test("uses provider tab for committed changes", () => {
    expect(getDefaultDetailTab(commit("a".repeat(40)), "snyk")).toBe("snyk");
  });

  test("uses files tab for committed changes in git view", () => {
    expect(getDefaultDetailTab(commit("a".repeat(40)), "git")).toBe("files");
  });
});

describe("getUncommittedProviderNotice", () => {
  test("explains provider limitation", () => {
    expect(getUncommittedProviderNotice("snyk")).toBe("Snyk data unavailable for uncommitted changes.");
    expect(getUncommittedProviderNotice("github-actions")).toBe(
      "GitHub Actions data unavailable for uncommitted changes.",
    );
  });

  test("is hidden in git view", () => {
    expect(getUncommittedProviderNotice("git")).toBeNull();
  });
});
