import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, type ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { AppStateContext, createAppState, type ProviderStatus } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { buildGraph } from "../../git/graph";
import type { CommitDetail } from "../../git/types";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import type { GitHubJob, GitHubWorkflowRun } from "../../providers/github-actions/types";
import type { JenkinsJob, JenkinsRun } from "../../providers/jenkins/types";
import type { OpenShiftCommitData, OpenShiftResource } from "../../providers/openshift/types";
import type { SnykScanResult } from "../../providers/snyk/types";
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
  counts: { critical: 0, high: 1, medium: 1, low: 0 },
  findings: ["high", "medium"].map(severity => ({
    id: `finding-${severity}`,
    title: `${severity} vulnerability metadata`,
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
        snykGetCommitData: () => (hasData() ? scan : null),
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
  const dispose = () => {
    resolveJobs();
    resolveReload();
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    setup.renderer.destroy();
  };
  try {
    await flush();
    setShowCompact(compact);
    await flush();
  } catch (error) {
    dispose();
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
      d.dispose();
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
      d.dispose();
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
    d.dispose();
  }
});

test("Snyk severity/finding/scan actions ignore empty severities and loading scans", async () => {
  const d = await renderProvider("snyk");
  try {
    expect(d.navRef.itemCount).toBe(5);
    await hoverAndRightClick(d, "HIGH");
    await hoverAndRightClick(d, "high-package@1.0.0");
    await d.click("high-package@1.0.0");
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.state.detailCursorAction()).toBe("collapse");
    expect(d.frame()).toContain("high vulnerability metadata");
    expect(d.navRef.itemRefs[2] === d.text("high-package@1.0.0").parent).toBe(true);
    await d.click("high-package@1.0.0");
    expect(d.frame()).not.toContain("high vulnerability metadata");
    await d.click("HIGH");
    expect(d.navRef.itemCount).toBe(4);
    expect(d.frame()).not.toContain("high-package@1.0.0");
    await d.click("medium-package@1.0.0");
    expect(d.state.detailCursorIndex()).toBe(3);
    expect(d.frame()).toContain("medium vulnerability metadata");
    await d.click("MEDIUM");
    expect(d.navRef.itemCount).toBe(3);
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
      expect(d.navRef.itemCount).toBe(3);
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
    await d.click("Scan commit");
    expect(d.scanCommit).toHaveBeenLastCalledWith(sha, false);
  } finally {
    d.dispose();
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
              : ["Rescan commit", "HIGH", "high-package@1.0.0"];
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
      d.dispose();
    }
  });
}
