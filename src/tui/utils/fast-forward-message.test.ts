import { describe, expect, test } from "bun:test";
import { fastForwardMessage } from "./fast-forward-message";

describe("fast-forward message", () => {
  test("ctrl+f and :pull always say what happened", () => {
    expect(fastForwardMessage({ moved: [{ branch: "main", commits: 3 }], skipped: [] }, true)).toEqual({
      kind: "info",
      source: "Git",
      title: "Fast-forwarded main by 3 commits",
      message: "",
    });
    expect(
      fastForwardMessage(
        {
          moved: [
            { branch: "dev", commits: 1 },
            { branch: "main", commits: 2 },
          ],
          skipped: [],
        },
        true,
      ),
    ).toEqual({
      kind: "info",
      source: "Git",
      title: "Fast-forwarded 2 branches",
      message: "dev by 1 commit\nmain by 2 commits",
    });
    expect(fastForwardMessage({ moved: [], skipped: [] }, true)).toEqual({
      kind: "info",
      source: "Git",
      title: "Nothing to fast-forward",
      message: "Every branch is up to date with its remote branch, or ahead of it.",
    });
  });

  test("a branch left behind is a warning that says why", () => {
    expect(
      fastForwardMessage(
        { moved: [{ branch: "dev", commits: 1 }], skipped: [{ branch: "main", reason: "local-changes" }] },
        true,
      ),
    ).toEqual({
      kind: "warning",
      source: "Git",
      title: "main not fast-forwarded",
      message: "main is checked out and has local changes.\nFast-forwarded dev by 1 commit.",
    });
    expect(
      fastForwardMessage(
        {
          moved: [],
          skipped: [
            { branch: "dev", reason: "other-worktree" },
            { branch: "feature", reason: "diverged" },
            { branch: "main", reason: "untracked", files: ["new.txt", "notes.md"] },
            { branch: "release", reason: "failed", detail: "cannot lock ref" },
          ],
        },
        true,
      ),
    ).toEqual({
      kind: "warning",
      source: "Git",
      title: "4 branches not fast-forwarded",
      message: [
        "dev is checked out in another worktree.",
        "feature has commits its remote branch doesn't have.",
        "main brings files that are untracked here: new.txt, notes.md.",
        "release: cannot lock ref.",
      ].join("\n"),
    });
  });

  test("f and Auto fetch say nothing when it worked, only which branches stayed behind", () => {
    expect(fastForwardMessage({ moved: [{ branch: "main", commits: 3 }], skipped: [] }, false)).toBeNull();
    expect(fastForwardMessage({ moved: [], skipped: [] }, false)).toBeNull();
    expect(
      fastForwardMessage(
        { moved: [{ branch: "dev", commits: 1 }], skipped: [{ branch: "main", reason: "local-changes" }] },
        false,
      ),
    ).toEqual({
      kind: "warning",
      source: "Git",
      title: "main not fast-forwarded",
      message: "main is checked out and has local changes.",
    });
  });
});
