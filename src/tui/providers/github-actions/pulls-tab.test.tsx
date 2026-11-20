import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DiffTarget } from "../../../core/git/types";
import type { GitHubPullRequest } from "../../../core/github/types";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { type GitHubDetailSource, githubPullsDetail } from "./detail-entry";
import { type PullFiles, PullRequestsTab } from "./pulls-tab";

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
  baseSha: "c".repeat(40),
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});

test("the tab lists the commit's open pull requests, one short row each: number, title, age; a draft muted", async () => {
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
      "├─ ▸ PR #124 release: dev into main 5m ago",
      "└─ ▸ PR #125 wip: dark mode 5m ago",
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

test("Enter opens a pull request: its branch, target and author, then its files from Git; Enter on a file opens its diff", async () => {
  const theme = createThemeState();
  const [cursor, setCursor] = createSignal(1);
  const opened = mock((_target: DiffTarget) => {});
  const files: PullFiles = {
    mergeBase: "b".repeat(40),
    files: [
      { path: "src/api/metrics.ts", status: "A", additions: 40, deletions: 0 },
      { path: "README.md", status: "M", additions: 2, deletions: 1 },
    ],
  };
  const pulls = [pull(), pull({ number: 125, baseRef: "release/1.x" })];
  const loadFiles = mock(async (pr: GitHubPullRequest) => (pr.number === 124 ? files : null));
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={90} flexDirection="column">
          <PullRequestsTab
            sha={SHA}
            pullRequestsAt={() => pulls}
            loadFiles={loadFiles}
            onOpenDiff={opened}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={mock(() => {})}
            setDetailCursorIndex={setCursor}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 94, height: 14 },
  );
  const lines = () =>
    setup
      .captureCharFrame()
      .split("\n")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(2);
  const enterOn = async (index: number) => {
    setCursor(index);
    navRef.activateCurrentItem();
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.renderOnce();
    }
  };
  try {
    // Reload commit is the first stop, PR #124 the second.
    await enterOn(1);
    expect(loadFiles).toHaveBeenCalledTimes(1);
    expect(lines()).toEqual([
      "├─ ▾ PR #124 release: dev into main 5m ago",
      "│ ├─ dev → main",
      "│ ├─ @ana-lima",
      "│ ├─ ▾ src/api/",
      "│ │ └─ metrics.ts A +40 -0",
      "│ └─ README.md M +2 -1",
      "└─ ▸ PR #125 release: dev into main 5m ago",
    ]);
    // Enter on a file: its diff, from where the branch left the target to its head, between the PR's files.
    await enterOn(4);
    expect(opened).toHaveBeenLastCalledWith({
      commitHash: SHA,
      filePath: "README.md",
      source: "range",
      status: "M",
      fileList: ["src/api/metrics.ts", "README.md"],
      fileIndex: 1,
      base: "b".repeat(40),
    });
    // Git hasn't the other one's commits.
    await enterOn(5);
    expect(lines().slice(-3)).toEqual([
      "├─ dev → release/1.x",
      "├─ @ana-lima",
      "└─ Its commits aren't fetched here: f fetches them.",
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("the graph previews a merge only for the pull request under the mouse or the cursor, none on Reload commit", async () => {
  const [cursor, setCursor] = createSignal(0);
  const [focused, setFocused] = createSignal(true);
  const previews: unknown[] = [];
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <box width={90} flexDirection="column">
          <PullRequestsTab
            sha={SHA}
            pullRequestsAt={() => [pull(), pull({ number: 125, baseRef: "release/1.x", baseSha: "d".repeat(40) })]}
            onMergePreview={preview => previews.push(preview)}
            mouseEnabled
            detailCursorIndex={cursor}
            detailFocused={focused}
            setDetailCursorAction={mock(() => {})}
            setDetailCursorIndex={setCursor}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 94, height: 10, useMouse: true },
  );
  try {
    await setup.renderOnce();
    expect(previews.at(-1)).toBeNull();
    // The mouse over a pull request, the keyboard anywhere: that one.
    const y = setup
      .captureCharFrame()
      .split("\n")
      .findIndex(line => line.includes("PR #124"));
    await setup.mockMouse.moveTo(10, y);
    await setup.renderOnce();
    expect(previews.at(-1)).toMatchObject({ head: SHA, baseRef: "main" });
    // The keys move on while the mouse stays: the cursor's.
    setCursor(2);
    await setup.renderOnce();
    expect(previews.at(-1)).toMatchObject({ baseRef: "release/1.x" });
    setCursor(0);
    await setup.mockMouse.moveTo(10, 9);
    await setup.renderOnce();
    expect(previews.at(-1)).toBeNull();
    setCursor(2);
    await setup.renderOnce();
    expect(previews.at(-1)).toEqual({ head: SHA, base: "d".repeat(40), baseRef: "release/1.x" });
    // The keyboard back in the graph: the details' cursor selects nothing.
    setFocused(false);
    await setup.renderOnce();
    expect(previews.at(-1)).toBeNull();
  } finally {
    setup.renderer.destroy();
  }
  // Closing the tab clears it.
  expect(previews.at(-1)).toBeNull();
});
