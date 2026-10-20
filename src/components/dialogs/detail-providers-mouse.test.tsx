import { expect, mock, spyOn, test } from "bun:test";
import {
  InputRenderable,
  type Renderable,
  RGBA,
  type ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { AppStateContext, createAppState, type ProviderStatus } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { buildGraph } from "../../git/graph";
import type { CommitDetail } from "../../git/types";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import * as clipboard from "../../hooks/use-clipboard";
import type { GitHubJob, GitHubWorkflowRun } from "../../providers/github-actions/types";
import type { JenkinsJob, JenkinsRun } from "../../providers/jenkins/types";
import type { OpenShiftCommitData, OpenShiftResource } from "../../providers/openshift/types";
import type { SnykScanResult } from "../../providers/snyk/types";
import { resetRepeatNav } from "../../utils/keyboard-nav-utils";
import DetailPanel, { type DetailPanelProps } from "../detail-panel";
import type { DetailNavRef } from "../detail-types";
import { DetailDialog } from "./detail-dialog";

const sha = "abc123456789";
const date = "2026-10-01T12:00:00Z";
const detail: CommitDetail = {
  hash: sha,
  shortHash: "abc1234",
  parents: [],
  subject: "Provider mouse fixture",
  body: "",
  author: "Alice",
  authorEmail: "alice@example.com",
  authorDate: date,
  committer: "Alice",
  committerEmail: "alice@example.com",
  commitDate: date,
  refs: [],
  files: [],
};
const githubRuns: GitHubWorkflowRun[] = [1, 2].map(id => ({
  id,
  name: `Workflow ${id}`,
  status: "completed",
  conclusion: "success",
  headSha: sha,
  event: "push",
  runNumber: id,
  startedAt: date,
  updatedAt: date,
}));
const githubJobs: GitHubJob[] = [1, 2].map(id => ({
  id,
  name: `GitHub job ${id}`,
  status: "completed",
  conclusion: "success",
  startedAt: date,
  completedAt: date,
  steps: [
    { name: "GitHub step", number: 1, status: "completed", conclusion: "success", startedAt: date, completedAt: date },
  ],
}));
const jenkinsRuns: JenkinsRun[] = githubRuns.map(run => ({
  ...run,
  id: String(run.id),
  name: `Build ${run.id}`,
  startedAt: date,
  url: "https://jenkins.invalid/build",
  jobLabel: "pipeline",
  jobUrl: "https://jenkins.invalid/job",
}));
const jenkinsJobs: JenkinsJob[] = githubJobs.map(job => ({
  ...job,
  id: String(job.id),
  name: `Jenkins job ${job.id}`,
  steps: [
    {
      id: "stage",
      name: "Jenkins stage",
      status: "completed",
      conclusion: "success",
      startedAt: date,
      completedAt: date,
    },
  ],
}));
const resources: OpenShiftResource[] = ["team-a", "team-b"].flatMap(namespace => [
  { id: `${namespace}-pod`, kind: "Pod", namespace, name: `${namespace}-pod`, status: "running", imageRefs: [] },
  { id: `${namespace}-tag-z`, kind: "ImageStreamTag", namespace, name: "app:z-tag", status: "pass", imageRefs: [] },
  { id: `${namespace}-tag-a`, kind: "ImageStreamTag", namespace, name: "app:a-tag", status: "pass", imageRefs: [] },
]);
const openshiftData: OpenShiftCommitData = {
  sha,
  liveFetched: true,
  namespaces: ["team-a", "team-b"].map(namespace => ({
    namespace,
    deployments: [],
    deploymentConfigs: [],
    builds: [],
    pods: resources.filter(resource => resource.namespace === namespace && resource.kind === "Pod"),
    imageStreamTags: resources.filter(
      resource => resource.namespace === namespace && resource.kind === "ImageStreamTag",
    ),
  })),
};
const scan: SnykScanResult = {
  sha,
  scannedAt: date,
  includesDev: true,
  dependencyProjects: [],
  counts: { critical: 0, high: 1, medium: 1, low: 0 },
  findings: ["high", "medium"].map(severity => ({
    id: `finding-${severity}`,
    title: `${severity} vulnerability metadata`,
    cves: [severity === "high" ? "CVE-2026-0001" : "CVE-2026-0002"],
    severity: severity as "high" | "medium",
    dependency: `${severity}-package`,
    installedVersion: "1.0.0",
    fixedVersion: "2.0.0",
    project: "fixture",
    targetFile: "package.json",
  })),
};
type Provider = "github-actions" | "jenkins" | "openshift" | "snyk";
const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderProvider(provider: Provider, compact = true, deferredJobs = false) {
  const theme = createThemeState();
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const [showCompact, setShowCompact] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [unavailable, setUnavailable] = createSignal(false);
  const [hasData, setHasData] = createSignal(true);
  const [snykScan, setSnykScan] = createSignal(scan);
  let resolveJobs!: () => void;
  const pendingJobs = new Promise<void>(resolve => (resolveJobs = resolve));
  let resolveReload!: () => void;
  const pendingReload = new Promise<void>(resolve => (resolveReload = resolve));
  const [holdReload, setHoldReload] = createSignal(false);
  const reload = mock(async (_sha: string, _force?: boolean) => {
    if (holdReload()) await pendingReload;
  });
  const githubFetchJobs = mock(async (_run: GitHubWorkflowRun, _signal?: AbortSignal) => {
    if (deferredJobs) await pendingJobs;
    return { jobs: githubJobs, error: null };
  });
  const jenkinsFetchJobs = mock(async (_run: JenkinsRun, _signal?: AbortSignal) => {
    if (deferredJobs) await pendingJobs;
    return { jobs: jenkinsJobs, error: null };
  });
  const openGithub = mock((_job: GitHubJob, _run: GitHubWorkflowRun, _jobs?: GitHubJob[]) => {});
  const openJenkins = mock((_job: JenkinsJob, _run: JenkinsRun, _jobs?: JenkinsJob[]) => {});
  const openResource = mock((_resource: OpenShiftResource) => {});
  const scanCommit = mock(async (_sha: string, _force?: boolean) => scan);
  let app!: ReturnType<typeof createAppState>;
  let scrollbox!: ScrollBoxRenderable;
  const status = (): ProviderStatus =>
    unavailable()
      ? { kind: "unavailable", message: "fixture unavailable" }
      : loading()
        ? { kind: "loading" }
        : { kind: "idle" };
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setCommits([detail]);
      app.actions.setGraphRows(buildGraph([detail]));
      app.actions.setCommitDetail(detail);
      app.actions.setActiveProviderView(provider);
      app.actions.setDetailActiveTab(provider);
      app.actions.setDetailFocused(true);
      useKeyboard(event =>
        handleDetailKey(event, {
          ...app,
          dialog: () => (compact ? "detail" : null),
          getDetailScrollboxRef: () => scrollbox,
          detailNavRef: navRef,
        }),
      );
      const props: DetailPanelProps = {
        navRef,
        searchFocused: false,
        onOpenDiff: () => {},
        onJumpToCommit: () => {},
        scrollboxRef: el => (scrollbox = el),
        githubGetCommitData: () => (hasData() ? { sha, runs: githubRuns } : null),
        githubFetchJobsForRun: githubFetchJobs,
        githubFetchCommitData: reload,
        get githubProviderStatus() {
          return status();
        },
        onOpenJobLog: openGithub,
        jenkinsGetCommitData: () => (hasData() ? { sha, runs: jenkinsRuns, resolved: true } : null),
        jenkinsFetchJobsForRun: jenkinsFetchJobs,
        jenkinsFetchCommitData: reload,
        get jenkinsProviderStatus() {
          return status();
        },
        onOpenJenkinsJobLog: openJenkins,
        openshiftGetCommitData: () => (hasData() ? openshiftData : null),
        openshiftFetchCommitData: reload,
        openshiftIsLoading: loading,
        openshiftLiveAge: () => "live fixture",
        get openshiftProviderStatus() {
          return status();
        },
        onOpenOpenShiftResource: openResource,
        snykGetCommitData: () => (hasData() ? snykScan() : null),
        snykScanCommit: scanCommit,
        snykIsScanning: loading,
      };
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <Show
              when={showCompact()}
              fallback={
                <box width={62} height={32} flexDirection="column">
                  <DetailPanel {...props} />
                </box>
              }
            >
              <DetailDialog {...props} onClose={() => {}} />
            </Show>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 80, height: 40, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const flush = () => setup.flush({ maxPasses: 20 });
  const frame = () => setup.captureCharFrame();
  const text = (label: string) => {
    const node = descendants(setup.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText.includes(label),
    );
    if (!(node instanceof TextRenderable)) throw new Error(`Missing text: ${label}`);
    return node;
  };
  const point = (label: string) => {
    if (label === "filter") {
      const row = descendants(setup.renderer.root).find(node => node instanceof InputRenderable)?.parent;
      if (!row) throw new Error("Filter row missing.");
      return { x: row.x + 1, y: row.screenY };
    }
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const cell = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await flush();
  };
  const dispose = async () => {
    resolveJobs();
    resolveReload();
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    await setup.dispose();
  };
  try {
    await flush();
    setShowCompact(compact);
    await flush();
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    ...setup,
    ...app,
    navRef,
    scrollbox,
    theme: theme.theme(),
    flush,
    frame,
    text,
    point,
    cell,
    click,
    dispose,
    reload,
    githubFetchJobs,
    jenkinsFetchJobs,
    openGithub,
    openJenkins,
    openResource,
    scanCommit,
    setLoading,
    setUnavailable,
    setHasData,
    setSnykScan,
    setHoldReload,
    resolveJobs,
    resolveReload,
  };
}

async function hoverAndRightClick(d: Awaited<ReturnType<typeof renderProvider>>, label: string) {
  const { x, y } = d.point(label);
  const bg = d.cell(x, y)?.bg;
  const cursor = d.state.detailCursorIndex();
  const action = d.state.detailCursorAction();
  const count = d.navRef.itemCount;
  const top = d.scrollbox.scrollTop;
  expect(d.text(label).selectable).toBe(false);
  await d.mockMouse.moveTo(x, y);
  await d.flush();
  expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
  await d.click(label, MouseButtons.RIGHT);
  expect(d.state.detailCursorIndex()).toBe(cursor);
  expect(d.state.detailCursorAction()).toBe(action);
  expect(d.navRef.itemCount).toBe(count);
  expect(d.scrollbox.scrollTop).toBe(top);
  await d.mockMouse.moveTo(0, 0);
  await d.flush();
  expect(d.cell(x, y)?.bg).toEqual(bg);
}

for (const provider of ["github-actions", "jenkins"] as const) {
  test(`${provider} compact run/job/reload actions use current flat indices and cached jobs`, async () => {
    const d = await renderProvider(provider);
    const github = provider === "github-actions";
    const runs = github ? githubRuns : jenkinsRuns;
    const jobs = github ? githubJobs : jenkinsJobs;
    const fetchJobs = github ? d.githubFetchJobs : d.jenkinsFetchJobs;
    const open = github ? d.openGithub : d.openJenkins;
    try {
      expect(d.frame()).toContain("Details");
      expect(d.navRef.itemCount).toBe(3);
      await hoverAndRightClick(d, runs[0].name);
      expect(fetchJobs).not.toHaveBeenCalled();
      await d.click(runs[0].name);
      expect(fetchJobs).toHaveBeenLastCalledWith(runs[0], expect.any(AbortSignal));
      expect(d.navRef.itemCount).toBe(5);
      expect(d.state.detailCursorIndex()).toBe(2);
      d.actions.setDetailCursorIndex(1);
      await d.flush();
      await hoverAndRightClick(d, jobs[1].name);
      expect(open).not.toHaveBeenCalled();
      await d.click(jobs[1].name);
      expect(d.state.detailCursorIndex()).toBe(3);
      expect(d.state.detailCursorAction()).toBe("view log");
      expect(open).toHaveBeenLastCalledWith(jobs[1], runs[0], jobs);
      expect(d.navRef.itemRefs[3] === d.text(jobs[1].name).parent).toBe(true);
      d.mockInput.pressKey("RETURN");
      await d.flush();
      expect(open).toHaveBeenCalledTimes(2);
      await d.click("enter view log");
      expect(open).toHaveBeenCalledTimes(3);
      await d.click(runs[1].name);
      expect(d.navRef.itemCount).toBe(7);
      await d.click(runs[0].name);
      expect(d.navRef.itemCount).toBe(5);
      expect(d.state.detailCursorIndex()).toBe(1);
      await d.click(runs[1].name);
      expect(d.state.detailCursorIndex()).toBe(2);
      expect(d.navRef.itemCount).toBe(3);
      await d.click(runs[0].name);
      expect(fetchJobs).toHaveBeenCalledTimes(2);
      await d.click(jobs[0].name);
      expect(open).toHaveBeenLastCalledWith(jobs[0], runs[0], jobs);
      await hoverAndRightClick(d, "Reload commit");
      expect(d.reload).not.toHaveBeenCalled();
      d.setHoldReload(true);
      await d.click("Reload commit");
      expect(d.reload).toHaveBeenLastCalledWith(sha, true);
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.state.detailCursorAction()).toBeNull();
      await d.click("Reload commit");
      expect(d.reload).toHaveBeenCalledTimes(1);
      d.resolveReload();
      await d.flush();
      expect(d.state.detailCursorAction()).toBe("reload");
      const { x, y } = d.point("Reload commit");
      expect(d.cell(x, y)?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElementActive));
      expect(d.renderer.getSelection()).toBeNull();
    } finally {
      await d.dispose();
    }
  });

  test(`${provider} loading and unavailable reload guards, asynchronous job loading`, async () => {
    const d = await renderProvider(provider, true, true);
    const runs = provider === "github-actions" ? githubRuns : jenkinsRuns;
    const fetchJobs = provider === "github-actions" ? d.githubFetchJobs : d.jenkinsFetchJobs;
    try {
      d.setLoading(true);
      await d.flush();
      await d.click("Reload commit");
      expect(d.reload).not.toHaveBeenCalled();
      d.setLoading(false);
      d.setUnavailable(true);
      await d.flush();
      await d.click("Reload commit");
      expect(d.reload).not.toHaveBeenCalled();
      d.setUnavailable(false);
      await d.click(runs[0].name);
      expect(d.frame()).toContain("loading jobs...");
      expect(d.navRef.itemCount).toBe(3);
      expect(fetchJobs).toHaveBeenCalledTimes(1);
      d.resolveJobs();
      await d.flush();
      expect(d.navRef.itemCount).toBe(5);
      expect(d.state.detailCursorIndex()).toBe(2);
      d.setHasData(false);
      await d.flush();
      await d.click("Load commit");
      expect(d.reload).toHaveBeenLastCalledWith(sha, true);
    } finally {
      await d.dispose();
    }
  });
}

test("OpenShift namespace/resource/reload routing follows grouped and sorted resource indices", async () => {
  const d = await renderProvider("openshift");
  try {
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.navRef.itemCount).toBe(9);
    await hoverAndRightClick(d, "team-a-pod");
    expect(d.openResource).not.toHaveBeenCalled();
    await d.click("team-a-pod");
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.openResource).toHaveBeenLastCalledWith(resources[0]);
    await d.click("a-tag");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.openResource).toHaveBeenLastCalledWith(resources[2]);
    expect(d.navRef.itemRefs[3] === d.text("a-tag").parent).toBe(true);
    await d.click("team-a");
    expect(d.navRef.itemCount).toBe(6);
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.state.detailCursorAction()).toBe("expand");
    await hoverAndRightClick(d, "team-b");
    await d.click("team-b-pod");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.openResource).toHaveBeenLastCalledWith(resources[3]);
    await d.click("team-b");
    expect(d.navRef.itemCount).toBe(3);
    await d.click("team-a");
    await d.click("z-tag");
    expect(d.state.detailCursorIndex()).toBe(4);
    expect(d.openResource).toHaveBeenLastCalledWith(resources[1]);
    await hoverAndRightClick(d, "Reload resources");
    await d.click("Reload resources");
    expect(d.reload).toHaveBeenLastCalledWith(sha, true);
    d.setLoading(true);
    await d.flush();
    await d.click("Reload resources");
    expect(d.reload).toHaveBeenCalledTimes(1);
    d.setLoading(false);
    d.setUnavailable(true);
    await d.flush();
    const cursor = d.state.detailCursorIndex();
    await d.click("Reload resources");
    expect(d.state.detailCursorIndex()).toBe(cursor);
    expect(d.reload).toHaveBeenCalledTimes(1);
    await d.click("team-a-pod");
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.openResource).toHaveBeenLastCalledWith(resources[0]);
  } finally {
    await d.dispose();
  }
});

test("Snyk severity/finding/scan actions ignore empty severities and loading scans", async () => {
  const d = await renderProvider("snyk");
  try {
    expect(d.navRef.itemCount).toBe(8);
    await hoverAndRightClick(d, "HIGH");
    await hoverAndRightClick(d, "CVE-2026-0001");
    await d.click("CVE-2026-0001");
    expect(d.state.detailCursorIndex()).toBe(5);
    expect(d.state.detailCursorAction()).toBe("collapse");
    expect(d.frame()).toContain("high vulnerability metadata");
    expect(d.navRef.itemRefs[5] === d.text("CVE-2026-0001").parent).toBe(true);
    await d.click("CVE-2026-0001");
    expect(d.frame()).not.toContain("high vulnerability metadata");
    await d.click("HIGH");
    expect(d.navRef.itemCount).toBe(7);
    expect(d.frame()).not.toContain("CVE-2026-0001");
    await d.click("CVE-2026-0002");
    expect(d.state.detailCursorIndex()).toBe(6);
    expect(d.frame()).toContain("medium vulnerability metadata");
    await d.click("MEDIUM");
    expect(d.navRef.itemCount).toBe(6);
    const cursor = d.state.detailCursorIndex();
    const action = d.state.detailCursorAction();
    for (const label of ["CRITICAL", "LOW"]) {
      const { x, y } = d.point(label);
      const bg = d.cell(x, y)?.bg;
      await d.mockMouse.moveTo(x, y);
      await d.click(label);
      expect(d.cell(x, y)?.bg).toEqual(bg);
      expect(d.state.detailCursorIndex()).toBe(cursor);
      expect(d.state.detailCursorAction()).toBe(action);
      expect(d.navRef.itemCount).toBe(6);
    }
    await hoverAndRightClick(d, "Rescan commit");
    expect(d.scanCommit).not.toHaveBeenCalled();
    await d.click("Rescan commit");
    expect(d.scanCommit).toHaveBeenLastCalledWith(sha, true);
    d.setLoading(true);
    await d.flush();
    await d.click("Rescan commit");
    expect(d.scanCommit).toHaveBeenCalledTimes(1);
    expect(d.state.detailCursorAction()).toBeNull();
    d.setLoading(false);
    d.setHasData(false);
    await d.flush();
    expect(d.navRef.itemCount).toBe(1);
    expect(d.frame()).not.toContain("Enter vulnerability filter...");
    await d.click("Scan commit");
    expect(d.scanCommit).toHaveBeenLastCalledWith(sha, false);
  } finally {
    await d.dispose();
  }
});

test("Snyk filter keeps severity rows and expansion choices, filtering only findings with original/current counts", async () => {
  const d = await renderProvider("snyk");
  try {
    expect(d.point("Enter vulnerability filter...").y).toBe(d.point("Rescan commit").y + 4);
    expect(d.frame()).not.toContain("Filter:");
    expect(d.frame()).not.toContain("total vulnerabilities");
    const rows = d.frame().split("\n");
    const high = rows.findIndex(line => line.includes("▾ HIGH"));
    expect(rows[high]).toMatch(/▾ HIGH\s+1\s*$/);
    expect(rows[high - 1]).toContain("CRITICAL");
    expect(rows[high - 2].trim()).toBe("");
    expect(rows.find(line => line.includes("CRITICAL"))).toMatch(/^\s{9}· CRITICAL\s+0\s*$/);
    expect(rows[high + 1]).toContain("└─ ▸ CVE-2026-0001");
    await d.click("CVE-2026-0001");
    expect(d.frame()).toContain("high vulnerability metadata");
    await d.click("filter");
    await d.mockInput.typeText("high-package");
    await d.flush();
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.frame()).toContain("CVE-2026-0001");
    expect(d.frame()).not.toContain("CVE-2026-0002");
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) expect(d.frame()).toContain(severity);
    expect(
      d
        .frame()
        .split("\n")
        .find(line => line.includes("HIGH")),
    ).toContain("1/1");
    expect(
      d
        .frame()
        .split("\n")
        .find(line => line.includes("MEDIUM")),
    ).toContain("0/1");
    const mediumRow =
      d
        .frame()
        .split("\n")
        .find(line => line.includes("MEDIUM")) ?? "";
    expect(mediumRow).toMatch(/^\s*· MEDIUM/);
    expect(d.cell(d.point("MEDIUM").x, d.point("MEDIUM").y)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    expect(d.frame()).toContain("high vulnerability metadata");
    expect(d.navRef.itemCount).toBe(10);
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    expect(d.frame()).toContain("CVE-2026-0001");
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    expect(d.frame()).toContain("CVE-2026-0002");
    expect(d.frame()).toContain("high vulnerability metadata");
    expect(
      d
        .frame()
        .split("\n")
        .find(line => line.includes("MEDIUM")),
    ).not.toContain("/1");
  } finally {
    await d.dispose();
  }
});

test("filtered zero counts stay muted and clearing preserves collapsed severity branches", async () => {
  const d = await renderProvider("snyk");
  try {
    await d.click("HIGH");
    expect(d.frame()).not.toContain("CVE-2026-0001");
    await d.click("filter");
    await d.mockInput.typeText("medium-package-missing");
    await d.flush();
    const lines = d.frame().split("\n");
    for (const label of ["medium-package-missing", "CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
      const y = lines.findIndex(line => line.includes(label));
      expect(y).toBeGreaterThanOrEqual(0);
      const x = lines[y].lastIndexOf("0");
      expect(x).toBeGreaterThanOrEqual(0);
      expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    }
    expect(d.frame()).not.toContain("No matching vulnerabilities.");
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    expect(d.frame()).not.toContain("CVE-2026-0001");
    expect(d.frame()).toContain("CVE-2026-0002");
  } finally {
    await d.dispose();
  }
});

test("Snyk entries show CVE + fix tag; details expose copyable package/via/manifest rows and fix line", async () => {
  const copy = mock((_text: string, _id: string) => {});
  const spy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  const d = await renderProvider("snyk");
  try {
    d.setSnykScan({
      ...scan,
      findings: [
        {
          ...scan.findings[0],
          dependencyType: "transitive",
          dependencyPath: ["org.fixture:parent@1.0.0", "high-package@1.0.0"],
          cvssScore: 9.8,
          exploit: "Mature",
        },
        { ...scan.findings[0], targetFile: "api/package.json", fixedVersion: null },
        {
          ...scan.findings[0],
          targetFile: "web/package.json",
          dependencyType: "transitive",
          dependencyPath: ["parent@1.0.0", "high-package@1.0.0"],
          upgradeDependency: "parent",
          upgradeVersion: "1.2.0",
        },
      ],
    });
    await d.flush();
    const rows = d
      .frame()
      .split("\n")
      .filter(line => line.includes("CVE-2026-0001"));
    // Same CVE in three manifests: three entries ordered by score then fix, no manifest on the row.
    // CVE rows: score, exploit marker and fix dot only; fix versions live in the details.
    expect(rows[0]).toMatch(/CVE-2026-0001\s+! 9\.8 ●\s*$/);
    // Score column stays aligned whether or not "!" is shown.
    expect(rows[0].indexOf("●")).toBe(rows[1].indexOf("●"));
    expect(rows[1]).toMatch(/CVE-2026-0001\s+●\s*$/);
    expect(rows[2]).toMatch(/CVE-2026-0001\s+●\s*$/);
    for (const cveRow of rows) expect(cveRow).not.toContain("→");
    expect(d.frame()).not.toContain("package.json");
    const legend = d
      .frame()
      .split("\n")
      .findIndex(line => line.includes("mature exploit"));
    const legendLine = d.frame().split("\n")[legend];
    expect(legendLine).toMatch(/● upgrade {2}● override {2}● no fix {2}! mature exploit/);
    for (const [marker, label, color] of [
      ["●", "upgrade", d.theme.success],
      ["●", "override", d.theme.warning],
      ["●", "no fix", d.theme.foregroundMuted],
      ["!", "mature exploit", d.theme.error],
    ])
      expect(d.cell(legendLine.indexOf(`${marker} ${label}`), legend)?.fg).toEqual(RGBA.fromHex(color));
    // Sticky: rendered below the scroll area, one blank row above it.
    let node: Renderable | null = d.text("mature exploit");
    while (node && node !== d.scrollbox) node = node.parent;
    expect(node).toBeNull();
    expect(d.frame().split("\n")[legend - 1].trim()).toBe("");
    // Right-aligned with the row tails (fix dots) above it.
    expect(legendLine.trimEnd().length).toBe(rows[0].trimEnd().length);
    const y = d.frame().split("\n").indexOf(rows[0]);
    const x = rows[0].lastIndexOf("●");
    expect(d.cell(x, y)?.fg).toEqual(RGBA.fromHex(d.theme.warning));
    expect(d.cell(rows[0].lastIndexOf("!"), y)?.fg).toEqual(RGBA.fromHex(d.theme.error));
    // Score in severity color, label plain.
    expect(d.cell(rows[0].lastIndexOf("9.8"), y)?.fg).toEqual(RGBA.fromHex(d.theme.severityHigh));
    expect(d.cell(rows[0].indexOf("CVE"), y)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
    await d.mockMouse.click(x, y);
    await d.flush();
    const frame = d.frame();
    for (const text of [
      "high vulnerability metadata",
      "high-package@1.0.0",
      "via parent@1.0.0",
      "package.json",
      "Fixed in 2.0.0",
      "Exploit: Mature",
    ])
      expect(frame).toContain(text);
    expect(frame).not.toContain("override required");
    const fix = d.point("Fixed in 2.0.0");
    expect(d.cell(fix.x, fix.y)?.fg).toEqual(RGBA.fromHex(d.theme.warning));
    await d.click("high vulnerability metadata");
    expect(copy).toHaveBeenLastCalledWith("high vulnerability metadata", expect.stringContaining(":title"));
    expect(frame).not.toContain("org.fixture");
    await d.click("via parent@1.0.0");
    expect(d.frame()).toContain("via org.fixture:parent@1.0.0");
    expect(copy).toHaveBeenLastCalledWith("org.fixture:parent@1.0.0", expect.stringContaining(":via"));
    expect(d.state.detailCursorAction()).toBe("copy");
    d.mockInput.pressKey("ARROW_DOWN");
    await d.flush();
    d.mockInput.pressKey("RETURN");
    await d.flush();
    expect(copy).toHaveBeenLastCalledWith("package.json", expect.stringContaining(":manifest"));
    // Every detail line is a cursor row: exploit and fix line copy too.
    for (const [text, id] of [
      ["Mature", ":exploit"],
      ["Fixed in 2.0.0", ":fix"],
    ]) {
      resetRepeatNav();
      d.mockInput.pressKey("ARROW_DOWN");
      await d.flush();
      d.mockInput.pressKey("RETURN");
      await d.flush();
      expect(copy).toHaveBeenLastCalledWith(text, expect.stringContaining(id));
    }
    resetRepeatNav();
    d.mockInput.pressKey("ARROW_DOWN");
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("expand");
    // Copy scan as JSON (below Rescan commit) copies the parsed scan: findings limited by the filter, no graphs.
    await d.click("Copy scan as JSON");
    const [json, id] = copy.mock.calls.at(-1) ?? [];
    expect(id).toBe("copyJson");
    const copied = JSON.parse(json ?? "{}");
    expect(copied.commit).toBe(sha);
    expect(copied.findings).toHaveLength(3);
    expect(copied.findings[0]).toMatchObject({ cves: ["CVE-2026-0001"], dependency: "high-package" });
    expect(copied.filter).toBeNull();
    expect(copied.filteredCounts).toEqual({ critical: 0, high: 3, medium: 0, low: 0 });
    expect(JSON.stringify(copied)).not.toContain("graphs");
    await d.click("filter");
    await d.mockInput.typeText("api/package.json");
    await d.flush();
    d.mockInput.pressKey("RETURN");
    await d.flush();
    await d.click("Copy scan as JSON");
    const filtered = JSON.parse(copy.mock.calls.at(-1)?.[0] ?? "{}");
    expect(filtered.filter).toBe("api/package.json");
    expect(filtered.counts).toEqual(copied.counts);
    expect(filtered.filteredCounts).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
    expect(filtered.findings.map((finding: { targetFile: string }) => finding.targetFile)).toEqual([
      "api/package.json",
    ]);
  } finally {
    await d.dispose();
    spy.mockRestore();
  }
});

test("Group by cycles severity → dependency; groups list targets and CVEs under each direct dependency", async () => {
  const copy = mock((_text: string, _id: string) => {});
  const spy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  const d = await renderProvider("snyk");
  try {
    const transitive = {
      dependencyType: "transitive" as const,
      dependencyPath: ["org.fixture:starter@4.1.1", "high-package@1.0.0"],
    };
    d.setSnykScan({
      ...scan,
      findings: [
        { ...scan.findings[0], ...transitive, cvssScore: 9.3, exploit: "Mature" },
        {
          ...scan.findings[1],
          ...transitive,
          dependency: "medium-package",
          installedVersion: "10.0.0",
          fixedVersion: "10.0.10",
        },
        {
          ...scan.findings[1],
          ...transitive,
          id: "finding-unfixed",
          cves: ["CVE-2026-0008"],
          dependency: "unfixed-package",
          fixedVersion: null,
        },
        {
          ...scan.findings[0],
          id: "finding-none",
          cves: ["CVE-2026-0009"],
          targetFile: "api/package.json",
          fixedVersion: null,
        },
      ],
    });
    await d.flush();
    const groupRow = () =>
      d
        .frame()
        .split("\n")
        .find(line => line.includes("Group by")) ?? "";
    expect(groupRow()).toMatch(/Group by\s+\[severity\]/);
    expect(d.point("Group by").y).toBe(d.point("Rescan commit").y + 3);
    expect(d.point("Enter vulnerability filter...").y).toBe(d.point("Group by").y + 1);
    await d.click("Group by");
    expect(groupRow()).toMatch(/Group by\s+\[dependency\]/);
    expect(d.state.detailCursorAction()).toBe("switch");
    expect(d.frame()).not.toContain("HIGH");
    expect(d.frame()).not.toContain("no fix available");
    // Groups and packages start open; CVE details closed.
    // Group and package rows: name plus entry count (N, or N/M while filtering); no versions, dots or "!".
    const line = (text: string) =>
      d
        .frame()
        .split("\n")
        .findIndex(row => row.includes(text));
    const row = (text: string) => d.frame().split("\n")[line(text)] ?? "";
    expect(row("▾ starter@4.1.1")).toMatch(/starter@4\.1\.1\s+3\s*$/);
    expect(row("▾ high-package@1.0.0")).toMatch(/high-package@1\.0\.0\s+1\s*$/);
    // Top-level dependency names are bold, like severity headers; package rows are not.
    const bold = (text: string) => {
      const y = line(text);
      let column = 0;
      const span = d.captureSpans().lines[y]?.spans.find(item => {
        column += item.text.length;
        return column > row(text).indexOf(text.replace(/^[▾▸] /, ""));
      });
      return ((span?.attributes ?? 0) & TextAttributes.BOLD) !== 0;
    };
    expect(bold("▾ starter@4.1.1")).toBe(true);
    expect(bold("▾ medium-package")).toBe(false);
    for (const name of ["high-package", "medium-package", "unfixed-package"])
      expect(row(`▾ ${name}`)).toMatch(new RegExp(`├─ ▾ ${name}\\s+1\\s*$|└─ ▾ ${name}\\s+1\\s*$`));
    expect(d.frame()).not.toMatch(/package\s+\d+\.\d+\.\d+ →/);
    // Override-fixable groups sort before unfixable ones.
    expect(line("▾ starter@4.1.1")).toBeLessThan(line("▾ high-package@1.0.0"));
    // The dependency itself is a muted "self" package row.
    const selfY = line("▾ self");
    expect(row("▾ self")).toMatch(/└─ ▾ self\s+1\s*$/);
    expect(d.cell(row("▾ self").indexOf("self"), selfY)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    // CVEs are visible under open packages.
    const cveY = line("CVE-2026-0001");
    const cveRow = row("CVE-2026-0001");
    expect(cveRow).toMatch(/│ {2}└─ ▸ CVE-2026-0001\s+! 9\.3 ●\s*$/);
    expect(d.cell(cveRow.indexOf("CVE"), cveY)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
    expect(d.cell(cveRow.indexOf("9.3"), cveY)?.fg).toEqual(RGBA.fromHex(d.theme.severityHigh));
    expect(row("CVE-2026-0008")).not.toContain("→");
    expect(d.frame()).not.toContain("org.fixture");
    // Closing a package closes its open CVEs too.
    await d.click("CVE-2026-0001");
    expect(d.frame()).toContain("high vulnerability metadata");
    await d.mockMouse.click(row("▾ high-package").indexOf("high-package"), line("▾ high-package"));
    await d.flush();
    expect(d.frame()).not.toContain("CVE-2026-0001");
    await d.mockMouse.click(row("▸ high-package").indexOf("high-package"), line("▸ high-package"));
    await d.flush();
    expect(d.frame()).toContain("CVE-2026-0001");
    expect(d.frame()).not.toContain("high vulnerability metadata");
    // Closing a group closes its packages and CVEs; reopening shows them closed.
    await d.click("CVE-2026-0001");
    await d.click("starter@4.1.1");
    expect(d.frame()).not.toContain("medium-package");
    await d.click("starter@4.1.1");
    expect(row("medium-package")).toContain("▸ medium-package");
    expect(d.frame()).not.toContain("CVE-2026-0001");
    await d.mockMouse.click(row("▸ high-package").indexOf("high-package"), line("▸ high-package"));
    await d.flush();
    expect(d.frame()).not.toContain("high vulnerability metadata");
    // The filter and total apply to the dependency view as well.
    await d.click("filter");
    await d.mockInput.typeText("medium-package");
    await d.flush();
    expect(d.frame()).toContain("1/4");
    // Like severities: groups and packages stay listed; filtered to zero they are muted, "·", 0/M.
    expect(row("starter@4.1.1")).toMatch(/starter@4\.1\.1\s+1\/3\s*$/);
    expect(row("▸ medium-package")).toMatch(/medium-package\s+1\/1\s*$/);
    expect(row("· high-package ")).toMatch(/· high-package\s+0\/1\s*$/);
    expect(row("· high-package@1.0.0")).toMatch(/· high-package@1\.0\.0\s+0\/1\s*$/);
    const emptyY = line("· high-package@1.0.0");
    expect(d.cell(row("· high-package@1.0.0").indexOf("high-package"), emptyY)?.fg).toEqual(
      RGBA.fromHex(d.theme.foregroundMuted),
    );
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    d.mockInput.pressKey("ESCAPE");
    await d.flush();
    await d.click("Group by");
    expect(groupRow()).toMatch(/Group by\s+\[severity\]/);
    expect(d.frame()).toContain("HIGH");
  } finally {
    await d.dispose();
    spy.mockRestore();
  }
});

test("closing a severity closes its open CVEs", async () => {
  const d = await renderProvider("snyk");
  try {
    await d.click("CVE-2026-0001");
    expect(d.frame()).toContain("high vulnerability metadata");
    await d.click("HIGH");
    await d.click("HIGH");
    expect(d.frame()).toContain("CVE-2026-0001");
    expect(d.frame()).not.toContain("high vulnerability metadata");
  } finally {
    await d.dispose();
  }
});

test("Snyk scan without vulnerabilities hides the filter row", async () => {
  const d = await renderProvider("snyk");
  try {
    d.setSnykScan({ ...scan, counts: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [] });
    await d.flush();
    expect(d.frame()).not.toContain("Enter vulnerability filter...");
    expect(d.navRef.itemCount).toBe(2);
    expect(d.frame()).not.toContain("mature exploit");
    const rows = d.frame().split("\n");
    expect(rows[rows.findIndex(line => line.includes("Rescan commit")) + 3]).toMatch(/^\s{9}· CRITICAL\s+0\s*$/);
  } finally {
    await d.dispose();
  }
});

for (const provider of ["github-actions", "jenkins", "openshift", "snyk"] as const) {
  test(`${provider} sidebar keeps selectable rows and has no mouse actions`, async () => {
    const d = await renderProvider(provider, false);
    try {
      if (provider === "github-actions" || provider === "jenkins") {
        d.actions.setDetailCursorIndex(1);
        d.navRef.activateCurrentItem();
        await d.flush();
      }
      const labels =
        provider === "github-actions"
          ? ["Reload commit", "Workflow 1", "GitHub job 1"]
          : provider === "jenkins"
            ? ["Reload commit", "Build 1", "Jenkins job 1"]
            : provider === "openshift"
              ? ["Reload resources", "team-a", "team-a-pod", "a-tag"]
              : ["Rescan commit", "HIGH", "CVE-2026-0001"];
      const cursor = d.state.detailCursorIndex();
      const action = d.state.detailCursorAction();
      const count = d.navRef.itemCount;
      for (const label of labels) {
        const { x, y } = d.point(label);
        const bg = d.cell(x, y)?.bg;
        expect(d.text(label).selectable).toBe(true);
        await d.mockMouse.moveTo(x, y);
        await d.flush();
        expect(d.cell(x, y)?.bg).toEqual(bg);
        await d.click(label);
        expect(d.state.detailCursorIndex()).toBe(cursor);
        expect(d.state.detailCursorAction()).toBe(action);
        expect(d.navRef.itemCount).toBe(count);
      }
      expect(d.reload).not.toHaveBeenCalled();
      expect(d.openGithub).not.toHaveBeenCalled();
      expect(d.openJenkins).not.toHaveBeenCalled();
      expect(d.openResource).not.toHaveBeenCalled();
      expect(d.scanCommit).not.toHaveBeenCalled();
    } finally {
      await d.dispose();
    }
  });
}

test("Dependencies pins its own legend when the scan has findings", async () => {
  const d = await renderProvider("snyk");
  try {
    d.setSnykScan({
      ...scan,
      // The legend samples the highest score: high 7.5 beats medium 9.1 (severity first).
      findings: scan.findings.map(finding => ({ ...finding, cvssScore: finding.severity === "high" ? 7.5 : 9.1 })),
      dependencyProjects: [
        {
          targetFile: "package.json",
          packageManager: "yarn",
          status: "scanned",
          reason: null,
          graphs: [
            {
              targetFile: "package.json",
              packageManager: "yarn",
              rootNodeId: "root",
              packages: [
                { id: "root", name: "fixture", version: "1.0.0" },
                { id: "high", name: "high-package", version: "1.0.0" },
              ],
              nodes: [
                { nodeId: "root", pkgId: "root", deps: ["high"], scope: "unknown", referenceNodeId: null },
                { nodeId: "high", pkgId: "high", deps: [], scope: "prod", referenceNodeId: null },
              ],
            },
          ],
        },
      ],
    });
    d.actions.setDetailActiveTab("snyk-deps");
    await d.flush();
    const lines = d.frame().split("\n");
    const legend = lines.findIndex(line => line.includes("score (nested)"));
    expect(lines[legend]).toMatch(/! ! mature exploit \(nested\) {2}7\.5 7\.5 score \(nested\)\s*$/);
    expect(lines[legend - 1].trim()).toBe("");
    // First marker coloured (the package's own), second muted (nested in a closed row); labels muted.
    const exploitAt = lines[legend].indexOf("! !");
    const scoreAt = lines[legend].indexOf("7.5 7.5");
    for (const [x, color] of [
      [exploitAt, d.theme.error],
      [exploitAt + 2, d.theme.foregroundMuted],
      [scoreAt, d.theme.severityHigh],
      [scoreAt + 4, d.theme.foregroundMuted],
      [lines[legend].indexOf("score (nested)"), d.theme.foregroundMuted],
    ] as const)
      expect(d.cell(x, legend)?.fg).toEqual(RGBA.fromHex(color));
    expect(d.frame()).not.toContain("● upgrade");
    d.setSnykScan({ ...scan, findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } });
    await d.flush();
    expect(d.frame()).not.toContain("score (nested)");
  } finally {
    await d.dispose();
  }
});
