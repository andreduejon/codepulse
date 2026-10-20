import { expect, mock, spyOn, test } from "bun:test";
import { InputRenderable, type KeyEvent, type Renderable, RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { UNCOMMITTED_HASH } from "../constants";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext } from "../context/theme";
import { buildGraph } from "../git/graph";
import * as repo from "../git/repo";
import type { CommitDetail, DiffTarget } from "../git/types";
import { handleDetailKey } from "../hooks/handle-detail-keys";
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
  includesDev: true,
  dependencyProjects: [],
  counts: { critical: 0, high: 1, medium: 0, low: 0 },
  findings: [
    {
      id: "finding",
      title: "Finding metadata",
      cves: ["CVE-2026-0100"],
      severity: "high",
      dependency: "fixture-package",
      installedVersion: "1.0.0",
      fixedVersion: "2.0.0",
      project: "fixture",
      targetFile: "package.json",
    },
  ],
};
async function renderSidebar(provider: ProviderView = "git", snykScan: SnykScanResult = scan) {
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
                  snykGetCommitData={sha => (sha === snykScan.sha ? snykScan : null)}
                  snykScanCommit={async () => {
                    await reload();
                    return snykScan;
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
    if (label === "filter") {
      const all = (node: Renderable): Renderable[] => node.getChildren().flatMap(child => [child, ...all(child)]);
      const row = all(setup.renderer.root).find(node => node instanceof InputRenderable)?.parent;
      if (!row) throw new Error("Filter row missing.");
      return { x: row.x + 1, y: row.screenY };
    }
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
  const dispose = async () => {
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    await setup.dispose();
  };
  try {
    await flush();
  } catch (error) {
    await dispose();
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
    await d.dispose();
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
    await d.dispose();
  }
});

test("tab bar hides stashes outside Git and keeps the full Vulnerabilities label clickable", async () => {
  const d = await renderSidebar();
  try {
    d.actions.setStashByParent(new Map([[detail.hash, [{ ...detail, hash: "stash", parents: [detail.hash] }]]]));
    await d.flush();
    expect(d.frame()).toContain("Stashes (1)");

    for (const provider of ["github-actions", "jenkins", "openshift", "snyk"] as const) {
      d.actions.setActiveProviderView(provider);
      d.actions.setDetailActiveTab("info");
      await d.flush();
      expect(d.frame()).not.toContain("Stashes (1)");
      if (provider === "snyk") {
        const label = d.point("Vulnerabilities");
        expect(label.x + "Vulnerabilities".length).toBeLessThan(d.point("Info").x);
        await d.click("Vulnerabilities");
        expect(d.state.detailActiveTab()).toBe("snyk");
        expect(d.frame()).toContain("CVE-2026-0100");
      }
    }

    d.actions.setActiveProviderView("git");
    await d.flush();
    expect(d.frame()).toContain("Stashes (1)");
  } finally {
    await d.dispose();
  }
});

test("Dependencies tab routes cached graphs and owns keyboard cursor navigation alongside Vulnerabilities and Info", async () => {
  const withDependencies: SnykScanResult = {
    ...scan,
    dependencyProjects: [
      {
        targetFile: "bun.lock",
        packageManager: "bun",
        status: "scanned",
        reason: null,
        graphs: [
          {
            targetFile: "yarn.lock",
            packageManager: "yarn",
            rootNodeId: "root",
            packages: [
              { id: "fixture-deps@1.0.0", name: "fixture-deps", version: "1.0.0" },
              { id: "fixture-parent@1.0.0", name: "fixture-parent", version: "1.0.0" },
              { id: "fixture-child@1.0.0", name: "fixture-child", version: "1.0.0" },
            ],
            nodes: [
              {
                nodeId: "root",
                pkgId: "fixture-deps@1.0.0",
                deps: ["parent"],
                scope: "unknown",
                referenceNodeId: null,
              },
              {
                nodeId: "parent",
                pkgId: "fixture-parent@1.0.0",
                deps: ["child"],
                scope: "prod",
                referenceNodeId: null,
              },
              { nodeId: "child", pkgId: "fixture-child@1.0.0", deps: [], scope: "dev", referenceNodeId: null },
            ],
          },
        ],
      },
    ],
  };
  const d = await renderSidebar("snyk", withDependencies);
  const key = async (name: string) => {
    handleDetailKey({ name, preventDefault() {} } as KeyEvent, {
      state: d.state,
      actions: d.actions,
      dialog: () => null,
      getDetailScrollboxRef: () => d.scrollbox,
      detailNavRef: d.navRef,
      getCommitData: () => withDependencies,
    });
    await d.flush();
  };
  try {
    expect(d.frame()).toContain("Dependencies");
    await d.click("Vulnerabilities");
    await key("right");
    expect(d.state.detailActiveTab()).toBe("snyk-deps");
    expect(d.frame()).toContain("bun.lock (converted)");
    expect(d.frame()).toContain("fixture-parent@1.0.0");
    expect(d.frame()).not.toContain("fixture-child@1.0.0");

    await d.click("fixture-parent@1.0.0");
    expect(d.state.detailCursorIndex()).toBeGreaterThan(0);
    expect(d.state.detailCursorAction()).toBe("collapse");
    expect(d.frame()).toContain("fixture-child@1.0.0");
    const selected = d.state.detailCursorIndex();
    await key("return");
    expect(d.state.detailCursorIndex()).toBe(selected);
    expect(d.state.detailCursorAction()).toBe("expand");
    expect(d.frame()).not.toContain("fixture-child@1.0.0");

    await key("right");
    expect(d.state.detailActiveTab()).toBe("info");
    await key("left");
    expect(d.state.detailActiveTab()).toBe("snyk-deps");
    expect(d.navRef.itemCount).toBeGreaterThan(1);
    await key("left");
    expect(d.state.detailActiveTab()).toBe("snyk");
    expect(d.frame()).toContain("CVE-2026-0100");

    d.actions.setCursorIndex(1);
    await d.flush();
    expect(d.frame().split("\n").slice(0, 3).join("\n")).toContain("Dependencies");
  } finally {
    await d.dispose();
  }
});

test("clearing either Snyk filter reveals its row after navigating deep into a long tree", async () => {
  const findings = Array.from({ length: 200 }, (_, index) => ({
    ...scan.findings[0],
    id: `fixture-${index}`,
    dependency: `fixture-${index}`,
  }));
  const many: SnykScanResult = {
    ...scan,
    counts: { critical: 0, high: 200, medium: 0, low: 0 },
    findings,
    dependencyProjects: [
      {
        targetFile: "bun.lock",
        packageManager: "bun",
        status: "scanned",
        reason: null,
        graphs: [
          {
            targetFile: "yarn.lock",
            packageManager: "yarn",
            rootNodeId: "root",
            packages: [
              { id: "fixture-root@1", name: "fixture-root", version: "1" },
              ...findings.map(finding => ({
                id: `${finding.dependency}@1.0.0`,
                name: finding.dependency,
                version: "1.0.0",
              })),
            ],
            nodes: [
              {
                nodeId: "root",
                pkgId: "fixture-root@1",
                deps: findings.map(finding => finding.id),
                scope: "unknown",
                referenceNodeId: null,
              },
              ...findings.map(finding => ({
                nodeId: finding.id,
                pkgId: `${finding.dependency}@1.0.0`,
                deps: [],
                scope: "prod" as const,
                referenceNodeId: null,
              })),
            ],
          },
        ],
      },
    ],
  };
  for (const tab of ["snyk", "snyk-deps"] as const) {
    const d = await renderSidebar("snyk", many);
    try {
      d.actions.setDetailActiveTab(tab);
      await d.flush();
      await d.click("filter");
      await d.mockInput.typeText("fixture");
      await d.flush();
      d.navRef.activateCurrentItem();
      await d.flush();
      d.actions.setDetailCursorIndex(150);
      d.scrollbox.scrollTo(110);
      await d.flush();
      expect(d.scrollbox.scrollTop).toBeGreaterThan(0);
      handleDetailKey({ name: "escape", preventDefault() {}, stopPropagation() {} } as KeyEvent, {
        state: d.state,
        actions: d.actions,
        dialog: () => null,
        getDetailScrollboxRef: () => d.scrollbox,
        detailNavRef: d.navRef,
      });
      await d.flush();
      // Vulnerabilities: Copy JSON and Group by above its filter; Dependencies adds Scope.
      const filterIndex = tab === "snyk" ? 3 : 4;
      expect(d.state.detailCursorIndex()).toBe(filterIndex);
      expect(d.scrollbox.scrollTop).toBeLessThanOrEqual(filterIndex);
      const row = d.navRef.itemRefs[filterIndex];
      expect(row.screenY).toBeGreaterThanOrEqual(d.scrollbox.viewport.screenY);
      expect(row.screenY).toBeLessThan(d.scrollbox.viewport.screenY + d.scrollbox.viewport.height);
    } finally {
      await d.dispose();
    }
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
    try {
      await d?.dispose();
    } finally {
      spy.mockRestore();
    }
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
    try {
      await d.dispose();
    } finally {
      load.mockRestore();
    }
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
    await d.dispose();
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
              : "CVE-2026-0100";
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
      await d.dispose();
    }
  }
});
