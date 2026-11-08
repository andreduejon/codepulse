import { expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { ProviderRunTree, type ProviderTreeJob, type ProviderTreeRun } from "./provider-run-tree";

const date = "2026-01-01T00:00:00Z";

const run = (status: string, conclusion: string | null, updatedAt: string): ProviderTreeRun<null> => ({
  id: "run-1",
  label: "CI",
  status,
  conclusion,
  runNumber: 7,
  startedAt: date,
  updatedAt,
  raw: null,
});

const job = (status: string, conclusion: string | null, stepStatus: string): ProviderTreeJob<null> => ({
  id: "job-1",
  name: "build",
  status,
  conclusion,
  startedAt: date,
  completedAt: status === "completed" ? date : null,
  steps: [
    {
      id: "step-1",
      name: "compile",
      status: stepStatus,
      conclusion: stepStatus === "completed" ? "success" : null,
      startedAt: date,
      completedAt: null,
    },
  ],
  raw: null,
});

async function renderTree() {
  const [runs, setRuns] = createSignal([run("in_progress", null, "2026-01-01T00:01:00Z")]);
  const [cursor, setCursor] = createSignal(0);
  let jobs = [job("in_progress", null, "in_progress")];
  const fetchJobs = mock(async () => ({ jobs, error: null }));
  const reload = mock(async () => {});
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
      <ThemeContext.Provider value={createThemeState()}>
        <box width={70} flexDirection="column">
          <ProviderRunTree
            runs={runs()}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            fetchJobsForRun={fetchJobs}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
            onReloadCommit={reload}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 80, height: 20 },
  );
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  await settle();
  return {
    ...setup,
    navRef,
    fetchJobs,
    reload,
    setRuns,
    setCursor,
    settle,
    setJobs: (next: ProviderTreeJob<null>[]) => {
      jobs = next;
    },
  };
}

test("Reload commit refreshes the jobs and steps of an expanded run that was still running", async () => {
  const t = await renderTree();
  try {
    t.setCursor(1);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(1);
    expect(t.captureCharFrame()).toContain("compile");
    t.setJobs([job("completed", "success", "completed")]);
    t.setCursor(0);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.fetchJobs).toHaveBeenCalledTimes(2);
    const childRows = t
      .captureCharFrame()
      .split("\n")
      .filter(line => line.includes("build") || line.includes("compile"));
    expect(childRows).toHaveLength(2);
    for (const line of childRows) expect(line).toContain("✓");
  } finally {
    t.renderer.destroy();
  }
});

test("an expanded run whose status changes on auto refresh reloads its jobs", async () => {
  const t = await renderTree();
  try {
    t.setCursor(1);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(1);
    t.setJobs([job("completed", "success", "completed")]);
    t.setRuns([run("completed", "success", "2026-01-01T00:05:00Z")]);
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(2);
    expect(t.captureCharFrame()).not.toContain("●");
  } finally {
    t.renderer.destroy();
  }
});

test("failure first: focusing the tab opens the first failed run with the cursor on its failed job", async () => {
  const [runs] = createSignal([
    { ...run("completed", "success", "2026-01-01T00:01:00Z"), id: "ok", label: "Lint" },
    { ...run("completed", "failure", "2026-01-01T00:02:00Z"), id: "bad", label: "Tests" },
  ]);
  const [cursor, setCursor] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  const fetchJobs = mock(async (_run: ProviderTreeRun<null>) => ({
    jobs: [
      { ...job("completed", "success", "completed"), id: "unit", name: "unit" },
      { ...job("completed", "failure", "completed"), id: "e2e", name: "e2e" },
    ],
    error: null,
  }));
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
      <ThemeContext.Provider value={createThemeState()}>
        <box width={70} flexDirection="column">
          <ProviderRunTree
            runs={runs()}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={focused}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            fetchJobsForRun={fetchJobs}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 80, height: 20 },
  );
  try {
    await setup.flush();
    // Browsing commits in the graph (no detail focus) fetches nothing.
    expect(fetchJobs).not.toHaveBeenCalled();
    setFocused(true);
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
    expect(fetchJobs).toHaveBeenCalledTimes(1);
    expect(fetchJobs.mock.calls[0]?.[0]).toMatchObject({ id: "bad" });
    // Runs: Lint (0), Tests (1), then Tests' jobs unit (2), e2e (3).
    expect(cursor()).toBe(3);
  } finally {
    setup.renderer.destroy();
  }
});

test("a cursored run whose name does not fit banner-scrolls instead of truncating", async () => {
  const long = "Workflow-with-a-name-far-too-long-for-this-panel-END";
  const [cursor, setCursor] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
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
      <ThemeContext.Provider value={createThemeState()}>
        <box width={40} flexDirection="column">
          <ProviderRunTree
            runs={[{ ...run("completed", "success", "2026-01-01T00:01:00Z"), label: long }]}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={focused}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            fetchJobsForRun={async () => ({ jobs: [], error: null })}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
            openFailedRun={false}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 50, height: 8 },
  );
  try {
    // Without detail focus nothing is cursored: the name is cut with …
    // (the label measures its box after the first layout, so let a second pass draw it).
    await setup.flush();
    await Bun.sleep(0);
    await setup.flush();
    const row = () =>
      setup
        .captureCharFrame()
        .split("\n")
        .find(line => line.includes("▸")) ?? "";
    expect(row()).toContain("…");
    const width = row().length;
    setFocused(true);
    await setup.flush();
    await Bun.sleep(700);
    await setup.flush();
    // Cursored: the label scrolls within the same width; the row never grows past the panel.
    expect(row()).not.toContain("…");
    expect(row()).not.toContain("Workflow-with-a-name-far");
    expect(row().trimEnd().length).toBeLessThanOrEqual(width);
  } finally {
    setup.renderer.destroy();
  }
});

test("jobs that fail to load show the reason under the run", async () => {
  const [cursor, setCursor] = createSignal(0);
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
      <ThemeContext.Provider value={createThemeState()}>
        <box width={70} flexDirection="column">
          <ProviderRunTree
            runs={[run("completed", "success", "2026-01-01T00:01:00Z")]}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            fetchJobsForRun={async () => ({ jobs: [], error: "GitHub jobs failed." })}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 80, height: 10 },
  );
  try {
    await setup.flush();
    navRef.activateCurrentItem();
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
    expect(setup.captureCharFrame()).toContain("└─ GitHub jobs failed.");
    expect(setup.captureCharFrame()).not.toContain("Unavailable");
  } finally {
    setup.renderer.destroy();
  }
});

test("a run that changes while its jobs are loading loads them again once that request settles", async () => {
  const t = await renderTree();
  try {
    let release!: () => void;
    t.fetchJobs.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve({ jobs: [job("in_progress", null, "in_progress")], error: null });
        }),
    );
    t.setCursor(1);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(1);
    // The run completes while its first job request is still pending.
    t.setJobs([job("completed", "success", "completed")]);
    t.setRuns([run("completed", "success", "2026-01-01T00:05:00Z")]);
    await t.settle();
    release();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(2);
    const childRows = t
      .captureCharFrame()
      .split("\n")
      .filter(line => line.includes("build") || line.includes("compile"));
    for (const line of childRows) expect(line).toContain("✓");
  } finally {
    t.renderer.destroy();
  }
});

test("Reload refreshes a completed job whose step was still running", async () => {
  const t = await renderTree();
  try {
    t.setRuns([run("completed", "success", "2026-01-01T00:05:00Z")]);
    t.setJobs([job("completed", "success", "in_progress")]);
    await t.settle();
    t.setCursor(1);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(1);
    t.setJobs([job("completed", "success", "completed")]);
    t.setCursor(0);
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.fetchJobs).toHaveBeenCalledTimes(2);
  } finally {
    t.renderer.destroy();
  }
});

test("wide-character run names are cut by terminal columns, keeping the ellipsis visible", async () => {
  const [cursor, setCursor] = createSignal(0);
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
      <ThemeContext.Provider value={createThemeState()}>
        <box width={40} flexDirection="column">
          <ProviderRunTree
            runs={[{ ...run("completed", "success", "2026-01-01T00:01:00Z"), label: `${"界".repeat(30)}END` }]}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => false}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            fetchJobsForRun={async () => ({ jobs: [], error: null })}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 50, height: 8 },
  );
  try {
    for (let i = 0; i < 3; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
    const row =
      setup
        .captureCharFrame()
        .split("\n")
        .find(line => line.includes("▸")) ?? "";
    expect(row).toContain("…");
    expect(row).toContain("✓");
  } finally {
    setup.renderer.destroy();
  }
});
