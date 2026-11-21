import { describe, expect, test } from "bun:test";
import type { Commit } from "../src/core/git/types";
import { UNCOMMITTED_HASH } from "../src/core/git/types";
import type { ProviderView } from "../src/core/provider-model";
import { getAvailableTabs, getDefaultDetailTab, getUncommittedProviderNotice } from "../src/tui/utils/tab-utils";
import { BUILT_IN_PROVIDERS } from "./test-helpers";

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
      expect(getDefaultDetailTab(uncommitted, providerView, BUILT_IN_PROVIDERS)).toBe("unstaged");
    }
  });

  test("uses provider tab for committed changes", () => {
    expect(getDefaultDetailTab(commit("a".repeat(40)), "snyk", BUILT_IN_PROVIDERS)).toBe("snyk");
  });

  test("uses files tab for committed changes in git view", () => {
    expect(getDefaultDetailTab(commit("a".repeat(40)), "git", BUILT_IN_PROVIDERS)).toBe("files");
  });
});

describe("getAvailableTabs", () => {
  const selected = commit("a".repeat(40));
  const input = {
    commit: selected,
    commitDetail: { ...selected, files: [{ path: "file.ts", status: "M" as const, additions: 1, deletions: 0 }] },
    uncommittedDetail: null,
    stashByParent: new Map([[selected.hash, [commit("b".repeat(40))]]]),
    providers: BUILT_IN_PROVIDERS,
  };

  test("includes stashes only in Git view, including the default view", () => {
    expect(getAvailableTabs(input)).toEqual(["files", "stashes", "info"]);
    expect(getAvailableTabs({ ...input, activeProviderView: "git" })).toEqual(["files", "stashes", "info"]);
    // GitHub's Pull requests only on a commit a pull request's branch points at: not this one.
    const tabLabel = (tab: string) => (tab === "github-pulls" ? null : undefined);
    for (const activeProviderView of ["github-actions", "jenkins"] as const) {
      expect(getAvailableTabs({ ...input, activeProviderView, tabLabel })).toEqual([activeProviderView, "info"]);
    }
    expect(getAvailableTabs({ ...input, activeProviderView: "openshift" })).toEqual([
      "openshift",
      "openshift-events",
      "info",
    ]);
  });

  test("a provider tab only some commits have shows on a commit that has it, after the provider's own", () => {
    const tabLabel = (tab: string, sha: string) =>
      tab === "github-pulls" ? (sha === selected.hash ? "Pull requests" : null) : undefined;
    expect(getAvailableTabs({ ...input, activeProviderView: "github-actions", tabLabel })).toEqual([
      "github-actions",
      "github-pulls",
      "info",
    ]);
    expect(
      getAvailableTabs({ ...input, commit: commit("c".repeat(40)), activeProviderView: "github-actions", tabLabel }),
    ).toEqual(["github-actions", "info"]);
  });

  test("omits stashes when the selected commit has none", () => {
    expect(getAvailableTabs({ ...input, stashByParent: new Map(), activeProviderView: "git" })).toEqual([
      "files",
      "info",
    ]);
  });

  test.each(["scanned", "skipped", "failed"])(
    "keeps Dependencies available for supported projects with %s status",
    status => {
      expect(
        getAvailableTabs({
          ...input,
          activeProviderView: "snyk",
          getCommitData: () => ({ dependencyProjects: [{ status }] }),
        }),
      ).toEqual(["snyk", "snyk-deps", "info"]);
    },
  );

  test("shows Dependencies before scanning and even when no supported project exists", () => {
    for (const data of [null, {}, { dependencyProjects: [] }]) {
      expect(getAvailableTabs({ ...input, activeProviderView: "snyk", getCommitData: () => data })).toEqual([
        "snyk",
        "snyk-deps",
        "info",
      ]);
    }
    expect(
      getAvailableTabs({ ...input, activeProviderView: "git", getCommitData: () => ({ dependencyProjects: [{}] }) }),
    ).toEqual(["files", "stashes", "info"]);
  });

  test("never shows Dependencies for uncommitted changes", () => {
    expect(
      getAvailableTabs({
        ...input,
        commit: commit(UNCOMMITTED_HASH),
        activeProviderView: "snyk",
        getCommitData: () => ({ dependencyProjects: [{}] }),
      }),
    ).toEqual([]);
  });
});

describe("getUncommittedProviderNotice", () => {
  test("explains provider limitation", () => {
    expect(getUncommittedProviderNotice("snyk", BUILT_IN_PROVIDERS)).toBe("No Snyk data for uncommitted changes.");
    expect(getUncommittedProviderNotice("github-actions", BUILT_IN_PROVIDERS)).toBe(
      "No GitHub data for uncommitted changes.",
    );
  });

  test("is hidden in git view", () => {
    expect(getUncommittedProviderNotice("git", BUILT_IN_PROVIDERS)).toBeNull();
  });
});
