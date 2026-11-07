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
