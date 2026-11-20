import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { GitHubPullRequest } from "../../../core/github/types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { type GitHubDetailSource, githubPullsDetail } from "./detail-entry";
import { PullRequestsTab } from "./pulls-tab";

const SHA = "a".repeat(40);

const pull = (overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  number: 124,
  title: "release: dev into main",
  url: "https://github.com/demo/shop/pull/124",
  draft: false,
  author: "ana-lima",
  headSha: SHA,
  headRef: "dev",
  baseRef: "main",
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});

test("the tab lists the commit's open pull requests: number, title, branch into its target, author; a draft muted", async () => {
  const theme = createThemeState();
  const [cursor, setCursor] = createSignal(0);
  const pulls = [pull(), pull({ number: 125, title: "wip: dark mode", baseRef: "release/1.x", draft: true })];
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={90} flexDirection="column">
          <PullRequestsTab
            sha={SHA}
            pullRequestsAt={() => pulls}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={mock(() => {})}
            setDetailCursorIndex={setCursor}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 94, height: 10 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    const lines = frame
      .split("\n")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    expect(lines).toEqual([
      "Reload commit",
      "total pull requests 2",
      "├─ PR #124 release: dev into main · dev → main · @ana-lima 5m ago",
      "└─ PR #125 wip: dark mode · dev → release/1.x · @ana-lima · draft 5m ago",
    ]);
    const fgOf = (text: string) => {
      const y = frame.split("\n").findIndex(line => line.includes(text));
      return setup.captureSpans().lines[y]?.spans.find(span => span.text.includes(text))?.fg;
    };
    expect(fgOf("PR #124")).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(fgOf("PR #125")).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
  } finally {
    setup.renderer.destroy();
  }
});

test("only a commit a pull request's branch points at has the tab, labelled with how many", () => {
  const source = {
    getCommitData: () => null,
    fetchJobsForRun: async () => ({ jobs: [], error: null }),
    pullRequestsAt: (sha: string) => (sha === SHA ? [pull(), pull({ number: 125 })] : []),
  } as GitHubDetailSource;
  expect(githubPullsDetail.label(source, SHA)).toBe("Pull requests (2)");
  expect(githubPullsDetail.label(source, "b".repeat(40))).toBeNull();
});
