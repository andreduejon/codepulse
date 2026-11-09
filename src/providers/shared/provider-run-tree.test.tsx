import { expect, mock, spyOn, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as browser from "../../utils/open-url";
import {
  ProviderRunTree,
  type ProviderTreeJob,
  type ProviderTreeNote,
  type ProviderTreeRun,
  type ProviderTreeStep,
} from "./provider-run-tree";

const date = "2026-01-01T00:00:00Z";
const RUN_URL = "https://github.com/o/r/actions/runs/1";
const JOB_URL = "https://github.com/o/r/actions/runs/1/job/2";

const run = (status: string, conclusion: string | null, updatedAt: string): ProviderTreeRun<null> => ({
  id: "run-1",
  label: "CI",
  status,
  conclusion,
  runNumber: 7,
  startedAt: date,
  updatedAt,
  url: RUN_URL,
  raw: null,
});

const job = (status: string, conclusion: string | null, stepStatus: string): ProviderTreeJob<null> => ({
  id: "job-1",
  name: "build",
  status,
  conclusion,
  startedAt: date,
  completedAt: status === "completed" ? date : null,
  url: JOB_URL,
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

async function renderTree(
  options: { onOpenNote?: (note: ProviderTreeNote) => void; onOpenStep?: (step: ProviderTreeStep) => void } = {},
) {
  const [runs, setRuns] = createSignal([run("in_progress", null, "2026-01-01T00:01:00Z")]);
  const [cursor, setCursor] = createSignal(0);
  let jobs = [job("in_progress", null, "in_progress")];
  const fetchJobs = mock(async () => ({ jobs, error: null }));
  const reload = mock(async () => {});
  const shortcut = mock((_shortcut: { key: string; desc: string } | null) => {});
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
            setDetailCursorShortcut={shortcut}
            fetchJobsForRun={fetchJobs}
            debugSource="GitHub"
            dataKey="sha"
            summaryLabel="total workflow runs"
            onReloadCommit={reload}
            onOpenNote={options.onOpenNote}
            noteAction="view in log"
            onOpenStep={options.onOpenStep}
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
    shortcut,
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

test("o opens the selected run or job page, and the footer offers it only on rows that have one", async () => {
  const openUrl = spyOn(browser, "openUrl").mockImplementation(() => {});
  const t = await renderTree();
  const press = (name: string) => t.navRef.handleKey?.({ name, ctrl: false, meta: false } as KeyEvent) ?? false;
  try {
    expect(t.shortcut).toHaveBeenLastCalledWith(null);
    expect(press("o")).toBe(false);
    t.setCursor(1);
    await t.settle();
    expect(t.shortcut).toHaveBeenLastCalledWith({ key: "o", desc: "open" });
    expect(press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(RUN_URL);
    t.navRef.activateCurrentItem();
    await t.settle();
    t.setCursor(2);
    await t.settle();
    expect(press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(JOB_URL);
    t.setRuns([{ ...run("completed", "success", "2026-01-01T00:05:00Z"), url: undefined }]);
    t.setCursor(1);
    await t.settle();
    expect(t.shortcut).toHaveBeenLastCalledWith(null);
    expect(press("o")).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(2);
  } finally {
    openUrl.mockRestore();
    t.renderer.destroy();
  }
});

test("a job's notes follow its steps under their label; Enter opens one and o opens its page", async () => {
  const openUrl = spyOn(browser, "openUrl").mockImplementation(() => {});
  const opened = mock((_note: ProviderTreeNote) => {});
  const t = await renderTree({ onOpenNote: opened });
  const press = (name: string) => t.navRef.handleKey?.({ name, ctrl: false, meta: false } as KeyEvent) ?? false;
  try {
    t.setJobs([
      {
        ...job("completed", "failure", "completed"),
        notesLabel: "Annotations",
        notes: [
          { id: "a1", mark: "fail", text: "src/auth.test.ts:42  Expected 200, received 401" },
          { id: "a2", mark: "warning", text: "src/api.ts:17  'token' is deprecated", url: "https://example.com/a2" },
        ],
      },
    ]);
    t.setRuns([run("completed", "failure", "2026-01-01T00:05:00Z")]);
    t.setCursor(1);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    const rows = t.captureCharFrame().split("\n");
    const at = (text: string) => rows.findIndex(row => row.includes(text));
    expect(at("compile")).toBeLessThan(at("Annotations"));
    expect(rows[at("compile")]).toContain("├─ compile");
    expect(rows[at("Annotations")]).toMatch(/└─ Annotations\s+2/);
    expect(rows[at("Expected 200")]).toContain("├─ ✗ src/auth.test.ts:42  Expected 200, received 401");
    expect(rows[at("deprecated")]).toContain("└─ ! src/api.ts:17");
    // Reload, run, job, then the two notes.
    t.setCursor(3);
    await t.settle();
    t.navRef.activateCurrentItem();
    expect(opened.mock.calls.at(-1)?.[0]).toMatchObject({ id: "a1" });
    expect(press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(JOB_URL);
    t.setCursor(4);
    await t.settle();
    expect(press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith("https://example.com/a2");
  } finally {
    openUrl.mockRestore();
    t.renderer.destroy();
  }
});

test("a re-run shows its latest attempt's jobs; earlier attempts fold into rows at the end", async () => {
  const openUrl = spyOn(browser, "openUrl").mockImplementation(() => {});
  const t = await renderTree();
  const press = (name: string) => t.navRef.handleKey?.({ name, ctrl: false, meta: false } as KeyEvent) ?? false;
  const attemptJob = (id: string, name: string, attempt: number, conclusion: string) => ({
    ...job("completed", conclusion, "completed"),
    id,
    name,
    attempt,
  });
  try {
    t.setJobs([
      attemptJob("j1", "lint", 1, "success"),
      attemptJob("j2", "test-first", 1, "failure"),
      attemptJob("j3", "lint", 2, "success"),
      attemptJob("j4", "test-again", 2, "success"),
    ]);
    t.setRuns([run("completed", "success", "2026-01-01T00:05:00Z")]);
    t.setCursor(1);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    let rows = t.captureCharFrame().split("\n");
    expect(rows.find(row => row.includes("CI #7"))).toContain("CI #7  attempt 2");
    expect(rows.some(row => row.includes("test-again"))).toBe(true);
    expect(rows.some(row => row.includes("test-first"))).toBe(false);
    const attemptRow = rows.find(row => row.includes("attempt 1")) ?? "";
    expect(attemptRow).toMatch(/└─ ▸ attempt 1/);
    expect(attemptRow).toContain("✗");
    // Reload, run, two jobs, then the attempt row.
    t.setCursor(4);
    await t.settle();
    expect(press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(`${RUN_URL}/attempts/1`);
    t.navRef.activateCurrentItem();
    await t.settle();
    rows = t.captureCharFrame().split("\n");
    expect(rows.find(row => row.includes("attempt 1"))).toMatch(/└─ ▾ attempt 1/);
    expect(rows.find(row => row.includes("test-first"))).toMatch(/ {6}└─ test-first/);
    expect(rows.findIndex(row => row.includes("test-again"))).toBeLessThan(
      rows.findIndex(row => row.includes("attempt 1")),
    );
  } finally {
    openUrl.mockRestore();
    t.renderer.destroy();
  }
});

test("with onOpenStep, steps are rows the cursor stops on, and Enter opens one", async () => {
  const opened = mock((_step: ProviderTreeStep) => {});
  const actions: (string | null)[] = [];
  const t = await renderTree({ onOpenStep: opened });
  try {
    t.setCursor(1);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    // Reload, run, job, then its step.
    expect(t.navRef.itemCount).toBe(4);
    t.setCursor(3);
    await t.settle();
    t.navRef.activateCurrentItem();
    expect(opened.mock.calls.at(-1)?.[0]).toMatchObject({ name: "compile" });
    actions.push(null);
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
