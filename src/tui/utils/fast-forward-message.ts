import type { FastForwardResult, FastForwardSkip } from "../../core/git/log";
import type { UIMessage } from "../components/message-box";

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`;

function why(skip: FastForwardSkip): string {
  switch (skip.reason) {
    case "local-changes":
      return `${skip.branch} is checked out and has local changes.`;
    case "diverged":
      return `${skip.branch} has commits its remote branch doesn't have.`;
    case "other-worktree":
      return `${skip.branch} is checked out in another worktree.`;
    case "untracked":
      return `${skip.branch} brings files that are untracked here: ${skip.files.join(", ")}.`;
    case "failed":
      return `${skip.branch}: ${skip.detail.replace(/\.$/, "")}.`;
  }
}

/**
 * What the banner says after a fast-forward. `explicit` (ctrl+f, `:pull`) always reports; after `f` or Auto fetch
 * with Auto fast-forward, the moved graph says enough, so only the branches that stayed behind are reported.
 */
export function fastForwardMessage(result: FastForwardResult, explicit: boolean): UIMessage | null {
  const { moved, skipped } = result;
  if (skipped.length > 0) {
    const lines = skipped.map(why);
    if (explicit)
      for (const { branch, commits: count } of moved) lines.push(`Fast-forwarded ${branch} by ${commits(count)}.`);
    return {
      kind: "warning",
      source: "Git",
      title:
        skipped.length === 1
          ? `${skipped[0]?.branch} not fast-forwarded`
          : `${skipped.length} branches not fast-forwarded`,
      message: lines.join("\n"),
    };
  }
  if (!explicit) return null;
  if (moved.length === 0)
    return {
      kind: "info",
      source: "Git",
      title: "Nothing to fast-forward",
      message: "Every branch is up to date with its remote branch, or ahead of it.",
    };
  if (moved.length === 1) {
    const [only] = moved;
    return {
      kind: "info",
      source: "Git",
      title: `Fast-forwarded ${only?.branch} by ${commits(only?.commits ?? 0)}`,
      message: "",
    };
  }
  return {
    kind: "info",
    source: "Git",
    title: `Fast-forwarded ${moved.length} branches`,
    message: moved.map(({ branch, commits: count }) => `${branch} by ${commits(count)}`).join("\n"),
  };
}
