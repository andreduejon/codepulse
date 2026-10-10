import { expect, mock, spyOn, test } from "bun:test";
import { RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { UNCOMMITTED_HASH } from "../constants";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import { buildGraph } from "../git/graph";
import * as repo from "../git/repo";
import type { CommitDetail, DiffTarget } from "../git/types";
import * as clipboard from "../hooks/use-clipboard";
import type { GitHubJob, GitHubWorkflowRun } from "../providers/github-actions/types";
import type { JenkinsJob, JenkinsRun } from "../providers/jenkins/types";
import type { OpenShiftResource } from "../providers/openshift/types";
import type { ProviderView } from "../providers/provider";
import type { SnykScanResult } from "../providers/snyk/types";
import DetailPanel from "./detail-panel";
import type { DetailNavRef } from "./detail-types";
import GraphView from "./graph";

const date = "2026-10-01T12:00:00Z";
const detail: CommitDetail = {
  hash: "abc123456789",
  shortHash: "abc1234",
  parents: [],
  subject: "Graph fixture",
  body: "Sidebar body",
  author: "Alice",
  authorEmail: "alice@example.com",
  authorDate: date,
  committer: "Alice",
  committerEmail: "alice@example.com",
  commitDate: date,
  refs: [],
  files: Array.from({ length: 40 }, (_, i) => ({
    path: `file-${String(i + 1).padStart(3, "0")}.ts`,
    status: "M",
    additions: 1,
    deletions: 0,
  })),
};
const run: GitHubWorkflowRun = {
  id: 1,
  name: "Workflow fixture",
  status: "completed",
  conclusion: "success",
  headSha: detail.hash,
  event: "push",
  runNumber: 1,
  startedAt: date,
  updatedAt: date,
};
const job: GitHubJob = {
  id: 1,
  name: "Job fixture",
  status: "completed",
  conclusion: "success",
  startedAt: date,
  completedAt: date,
  steps: [],
};
const jenkinsRun: JenkinsRun = {
  ...run,
  id: "1",
  name: "Build fixture",
  startedAt: date,
  url: "https://jenkins.invalid/build",
  jobLabel: "pipeline",
  jobUrl: "https://jenkins.invalid/job",
};
const jenkinsJob: JenkinsJob = { ...job, id: "1", steps: [] };
const resource: OpenShiftResource = {
  id: "pod",
  kind: "Pod",
  namespace: "team-fixture",
  name: "Pod fixture",
  status: "running",
  imageRefs: [],
};
const scan: SnykScanResult = {
  sha: detail.hash,
  scannedAt: date,
  counts: { critical: 0, high: 1, medium: 0, low: 0 },
  findings: [
    {
      id: "finding",
      title: "Finding metadata",
      severity: "high",
      dependency: "fixture-package",
      installedVersion: "1.0.0",
      fixedVersion: "2.0.0",
      project: "fixture",
      targetFile: "package.json",
    },
  ],
};
async function renderSidebar(provider: ProviderView = "git") {
  const theme = createThemeState();
  const [dialog, setDialog] = createSignal<string | null>(null);
  const [searchFocused, setSearchFocused] = createSignal(true);
  const [commandMode, setCommandMode] = createSignal("search");
  const [draft, setDraft] = createSignal("unfinished");
  const [busy, setBusy] = createSignal(false);
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
  let graphScrollbox!: ScrollBoxRenderable;
  const mouseEnabled = () => dialog() == null && app.state.keyboardScopeOverride() == null;
  const focus = mock(() => {
    setSearchFocused(false);
    setCommandMode("idle");
    setDraft("");
    app.actions.setDetailFocused(true);
  });
  const openDiff = mock((_target: DiffTarget) => expect(app.state.detailFocused()).toBe(true));
  const openJob = mock(() => expect(app.state.detailFocused()).toBe(true));
  const reload = mock(async () => {});
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      const commits = Array.from({ length: 40 }, (_, i) => ({
        ...detail,
        hash: i === 0 ? detail.hash : `hash-${i}`,
        shortHash: i === 0 ? detail.shortHash : `hash-${i}`,
        subject: i === 0 ? detail.subject : `Graph row ${i}`,
      }));
      app.actions.setCommits(commits);
      app.actions.setGraphRows(buildGraph(commits));
      app.actions.setLoading(false);
      app.actions.setCommitDetail(detail);
      app.actions.setActiveProviderView(provider);
      app.actions.setDetailActiveTab(provider === "git" ? "files" : provider);
      app.actions.setSearchQuery("applied");
      app.actions.setViewingBranch("main");
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <box flexDirection="row" width="100%" height="100%">
              <box width={60} flexDirection="column">
                <GraphView
                  mouseEnabled={mouseEnabled}
                  scrollboxRef={el => (graphScrollbox = el)}
                  onSelectRow={index => {
                    app.actions.setDetailFocused(false);
                    app.actions.setCursorIndex(index);
                  }}
                />
              </box>
              <box width={60} flexDirection="column">
                <DetailPanel
                  mouseEnabled={mouseEnabled()}
                  onMouseFocus={focus}
                  searchFocused={searchFocused()}
                  navRef={navRef}
                  scrollboxRef={el => (scrollbox = el)}
                  onJumpToCommit={() => {}}
                  onOpenDiff={openDiff}
                  githubGetCommitData={() => ({ sha: detail.hash, runs: [run] })}
                  githubFetchJobsForRun={async () => ({ jobs: [job], error: null })}
                  githubFetchCommitData={reload}
                  githubProviderStatus={busy() ? { kind: "loading" } : { kind: "idle" }}
                  onOpenJobLog={openJob}
                  jenkinsGetCommitData={() => ({ sha: detail.hash, runs: [jenkinsRun], resolved: true })}
                  jenkinsFetchJobsForRun={async () => ({ jobs: [jenkinsJob], error: null })}
                  jenkinsFetchCommitData={reload}
                  jenkinsProviderStatus={busy() ? { kind: "loading" } : { kind: "idle" }}
                  onOpenJenkinsJobLog={openJob}
                  openshiftGetCommitData={() => ({
                    sha: detail.hash,
                    liveFetched: true,
                    namespaces: [
                      {
                        namespace: resource.namespace,
                        pods: [resource],
                        deployments: [],
                        deploymentConfigs: [],
                        builds: [],
                        imageStreamTags: [],
                      },
                    ],
                  })}
                  openshiftFetchCommitData={reload}
                  openshiftIsLoading={busy}
                  onOpenOpenShiftResource={openJob}
                  snykGetCommitData={() => scan}
                  snykScanCommit={async () => {
                    await reload();
                    return scan;
                  }}
                  snykIsScanning={busy}
                />
              </box>
            </box>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 120, height: 24, useMouse: true, enableMouseMovement: true },
  );
  const flush = () => setup.flush({ maxPasses: 20 });
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    if (y < 0) throw new Error(`Missing visible text: ${label}\n${frame()}`);
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const clickAt = async (
    x: number,
    y: number,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    await setup.mockMouse.click(x, y, button);
    await flush();
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await clickAt(x, y, button);
  };
  const move = async (x = 0, y = 0) => {
    await setup.mockMouse.moveTo(x, y);
    await flush();
  };
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const dispose = () => {
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    setup.renderer.destroy();
  };
  try {
    await flush();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    ...setup,
    ...app,
    scrollbox,
    graphScrollbox,
    navRef,
    focus,
    openDiff,
    openJob,
    reload,
    setDialog,
    setBusy,
    searchFocused,
    commandMode,
    draft,
    flush,
    frame,
    point,
    clickAt,
    click,
    move,
    cell,
    dispose,
    theme: theme.theme(),
  };
}

test("sidebar first click focuses before file activation; hover, leave and wheel preserve focus and applied filters", async () => {
  const d = await renderSidebar();
  try {
    const row = d.point("file-002.ts");
    await d.move(row.x, row.y);
    expect(d.state.detailFocused()).toBe(false);
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.focus).not.toHaveBeenCalled();
    await d.click("file-002.ts", MouseButtons.RIGHT);
    expect(d.openDiff).not.toHaveBeenCalled();
    expect(d.state.detailFocused()).toBe(false);
    await d.click("file-002.ts");
    expect(d.focus).toHaveBeenCalledTimes(1);
    expect(d.openDiff).toHaveBeenCalledTimes(1);
    expect(d.openDiff.mock.calls[0][0].filePath).toBe("file-002.ts");
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.state.detailCursorAction()).toBe("view diff");
    expect(d.searchFocused()).toBe(false);
    expect(d.commandMode()).toBe("idle");
    expect(d.draft()).toBe("");
    expect(d.state.searchQuery()).toBe("applied");
    expect(d.state.viewingBranch()).toBe("main");
    await d.move();
    expect(d.state.detailFocused()).toBe(true);
    expect(d.cell(row.x, row.y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElementActive));
    await d.mockMouse.scroll(d.scrollbox.x + 4, d.scrollbox.y + 3, "down");
    await d.flush();
    expect(d.scrollbox.scrollTop).toBeGreaterThan(0);
    expect(d.state.detailFocused()).toBe(true);
    expect(d.focus).toHaveBeenCalledTimes(1);
    d.actions.setDetailFocused(false);
    await d.mockMouse.scroll(d.scrollbox.x + 4, d.scrollbox.y + 3, "down");
    await d.flush();
    expect(d.state.detailFocused()).toBe(false);
    expect(d.focus).toHaveBeenCalledTimes(1);
  } finally {
    d.dispose();
  }
});

test("sidebar tab edges, active tab and noninteractive area focus; disabled tabs do not", async () => {
  const d = await renderSidebar();
  try {
    for (const offset of [-1, 0, 1]) {
      d.actions.setDetailFocused(false);
      const info = d.point("Info");
      await d.clickAt(info.x, info.y + offset);
      expect(d.state.detailFocused()).toBe(true);
      expect(d.state.detailActiveTab()).toBe("info");
    }
    d.actions.setDetailFocused(false);
    await d.click("Branch", MouseButtons.RIGHT);
    expect(d.state.detailFocused()).toBe(false);
    await d.click("Branch");
    expect(d.state.detailFocused()).toBe(true);
    d.actions.setCommitDetail({ ...detail, files: [] });
    d.actions.setDetailFocused(false);
    await d.flush();
    const calls = d.focus.mock.calls.length;
    await d.click("Files (0)");
    expect(d.state.detailFocused()).toBe(false);
    expect(d.focus).toHaveBeenCalledTimes(calls);
    expect(d.state.detailActiveTab()).toBe("info");
    d.actions.setDetailActiveTab("files");
    await d.flush();
    await d.click("No modified files");
    expect(d.state.detailFocused()).toBe(true);
  } finally {
    d.dispose();
  }
});

test("Info row establishes focus before copy activation", async () => {
  let d: Awaited<ReturnType<typeof renderSidebar>> | undefined;
  const copy = mock(() => expect(d?.state.detailFocused()).toBe(true));
  const spy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  try {
    d = await renderSidebar();
    d.actions.setDetailActiveTab("info");
    await d.flush();
    await d.click(detail.hash);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenLastCalledWith(detail.hash, "hash");
    expect(d.focus).toHaveBeenCalledTimes(1);
    expect(d.state.detailCursorAction()).toBe("copy");
  } finally {
    d?.dispose();
    spy.mockRestore();
  }
});

test("stash and working-tree rows focus before their existing activation", async () => {
  const load = spyOn(repo, "getStashFiles").mockResolvedValue(detail.files.slice(0, 2));
  const d = await renderSidebar();
  try {
    const stash = {
      ...detail,
      hash: "stash-fixture",
      parents: [detail.hash],
      refs: [{ name: "stash@{0}", type: "stash" as const, isCurrent: false }],
    };
    d.actions.setStashByParent(new Map([[detail.hash, [stash]]]));
    d.actions.setDetailActiveTab("stashes");
    await d.flush();
    await d.click("stash@{0}");
    expect(d.state.detailFocused()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(d.frame()).toContain("file-002.ts");
    d.actions.setDetailFocused(false);
    await d.click("file-002.ts");
    expect(d.openDiff).toHaveBeenCalledTimes(1);
    expect(d.openDiff.mock.calls[0][0].source).toBe("stash");
    const working = { ...detail, hash: UNCOMMITTED_HASH };
    d.actions.setCommits([working]);
    d.actions.setGraphRows(buildGraph([working]));
    d.actions.setUncommittedDetail({ staged: [], unstaged: detail.files.slice(0, 2), untracked: [] });
    d.actions.setDetailActiveTab("unstaged");
    d.actions.setDetailFocused(false);
    await d.flush();
    await d.click("file-002.ts");
    expect(d.state.detailFocused()).toBe(true);
    expect(d.openDiff).toHaveBeenCalledTimes(2);
    expect(d.openDiff.mock.calls[1][0].source).toBe("unstaged");
    expect(d.focus).toHaveBeenCalledTimes(3);
  } finally {
    d.dispose();
    load.mockRestore();
  }
});

test("reactive dialog and keyboard-scope guards block sidebar and graph clicks, hover and native wheel", async () => {
  const d = await renderSidebar();
  try {
    await d.click("file-002.ts");
    for (const block of ["dialog", "scope"] as const) {
      if (block === "dialog") d.setDialog("diff");
      else d.actions.setKeyboardScopeOverride("repo-selector");
      await d.flush();
      const row = d.point("file-003.ts");
      const bg = d.cell(row.x, row.y)?.bg;
      await d.move(row.x, row.y);
      expect(d.cell(row.x, row.y)?.bg).toEqual(bg);
      await d.click("file-003.ts");
      await d.click("Info");
      await d.click("Graph row 1");
      expect(d.state.detailFocused()).toBe(true);
      expect(d.state.cursorIndex()).toBe(0);
      expect(d.state.detailCursorIndex()).toBe(1);
      expect(d.state.detailActiveTab()).toBe("files");
      expect(d.openDiff).toHaveBeenCalledTimes(1);
      expect(d.focus).toHaveBeenCalledTimes(1);
      for (const sb of [d.scrollbox, d.graphScrollbox]) {
        const top = sb.scrollTop;
        await d.mockMouse.scroll(sb.x + 4, sb.y + 3, "down");
        await d.flush();
        expect(sb.scrollTop).toBe(top);
      }
      d.setDialog(null);
      d.actions.setKeyboardScopeOverride(null);
      await d.flush();
      await d.click("Graph row 1", MouseButtons.RIGHT);
      expect(d.state.detailFocused()).toBe(true);
    }
    await d.click("Graph row 1");
    expect(d.state.detailFocused()).toBe(false);
    expect(d.state.cursorIndex()).toBe(1);
    await d.click("file-003.ts");
    expect(d.state.detailFocused()).toBe(true);
    expect(d.openDiff).toHaveBeenCalledTimes(2);
  } finally {
    d.dispose();
  }
});

test("provider rows focus on the first click, retain focus after leave, and busy scan/reload ignores hover and click", async () => {
  for (const provider of ["github-actions", "jenkins", "openshift", "snyk"] as const) {
    const d = await renderSidebar(provider);
    try {
      const label =
        provider === "github-actions"
          ? run.name
          : provider === "jenkins"
            ? jenkinsRun.name
            : provider === "openshift"
              ? resource.name
              : "fixture-package@1.0.0";
      const row = d.point(label);
      await d.move(row.x, row.y);
      expect(d.state.detailFocused()).toBe(false);
      await d.click(label);
      expect(d.state.detailFocused()).toBe(true);
      expect(d.focus).toHaveBeenCalledTimes(1);
      if (provider === "github-actions" || provider === "jenkins") {
        expect(d.frame()).toContain(job.name);
        d.actions.setDetailFocused(false);
        await d.click(job.name);
        expect(d.openJob).toHaveBeenCalledTimes(1);
      } else if (provider === "openshift") expect(d.openJob).toHaveBeenCalledTimes(1);
      else expect(d.frame()).toContain("Finding metadata");
      await d.move();
      expect(d.state.detailFocused()).toBe(true);
      d.actions.setDetailFocused(false);
      d.setBusy(true);
      await d.flush();
      const reloadLabel =
        provider === "snyk" ? "Rescan commit" : provider === "openshift" ? "Reload resources" : "Reload commit";
      const reloadPoint = d.point(reloadLabel);
      const bg = d.cell(reloadPoint.x, reloadPoint.y)?.bg;
      await d.move(reloadPoint.x, reloadPoint.y);
      expect(d.cell(reloadPoint.x, reloadPoint.y)?.bg).toEqual(bg);
      const calls = d.focus.mock.calls.length;
      await d.click(reloadLabel);
      expect(d.focus).toHaveBeenCalledTimes(calls);
      expect(d.state.detailFocused()).toBe(false);
      expect(d.reload).not.toHaveBeenCalled();
      d.setBusy(false);
      d.setDialog("log");
      await d.flush();
      await d.click(label);
      expect(d.state.detailFocused()).toBe(false);
      expect(d.focus).toHaveBeenCalledTimes(calls);
      d.setDialog(null);
      await d.flush();
      await d.click(reloadLabel);
      expect(d.state.detailFocused()).toBe(true);
      expect(d.reload).toHaveBeenCalledTimes(1);
    } finally {
      d.dispose();
    }
  }
});
