import { expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { JenkinsDetailTab } from "./detail-tab";
import type { JenkinsFailedTest, JenkinsJob, JenkinsRun, JenkinsStage } from "./types";

const SHA = "a".repeat(40);
const START = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds: number) => new Date(START + seconds * 1000).toISOString();

const run: JenkinsRun = {
  id: "main#41",
  name: "main",
  status: "completed",
  conclusion: "failure",
  headSha: SHA,
  runNumber: 41,
  startedAt: at(0),
  updatedAt: at(309),
  url: "https://jenkins.invalid/job/shop/job/main/41/",
  jobLabel: "shop",
  jobUrl: "https://jenkins.invalid/job/shop/job/main/",
};

const stage = (id: string, name: string, conclusion: string, from: number, seconds: number): JenkinsStage => ({
  id,
  name,
  status: "completed",
  conclusion,
  startedAt: at(from),
  completedAt: at(from + seconds),
});

const failedTest: JenkinsFailedTest = {
  className: "com.demo.shop.cart.CartTest",
  name: "roundsDiscountsToCents",
  details: "expected: <9.99> but was: <9.989999>",
  stackTrace: null,
};

const pipeline: JenkinsJob = {
  id: "main#41",
  name: "Pipeline",
  status: "completed",
  conclusion: "failure",
  startedAt: at(0),
  completedAt: at(309),
  steps: [
    stage("1", "Checkout", "success", 0, 4),
    stage("2", "Unit tests", "failure", 4, 210),
    stage("3", "Publish image", "skipped", 214, 0),
  ],
  tests: { passCount: 1204, failCount: 1, skipCount: 12, failed: [failedTest] },
};

async function renderJenkinsTab(jobs: JenkinsJob[] | (() => JenkinsJob[]), gate?: Promise<void>) {
  const [cursor, setCursor] = createSignal(0);
  const openBuild = mock((_run: JenkinsRun, _pipeline: JenkinsJob, _entry: number) => {});
  const openTest = mock((_run: JenkinsRun, _failed: JenkinsFailedTest[], _index: number) => {});
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
        <box width={60} flexDirection="column">
          <JenkinsDetailTab
            sha={SHA}
            getCommitData={() => ({ sha: SHA, runs: [run], resolved: true })}
            fetchJobsForRun={async () => {
              await gate;
              return { jobs: typeof jobs === "function" ? jobs() : jobs, error: null };
            }}
            fetchCommitData={async () => {}}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            onOpenBuild={openBuild}
            onOpenTestFailure={openTest}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 70, height: 20 },
  );
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  await settle();
  const row = (label: string) =>
    setup
      .captureCharFrame()
      .split("\n")
      .find(line => line.includes(label)) ?? "";
  /** Cursor on the row with this label, then Enter. */
  const activate = async (label: string) => {
    const rows = setup.captureCharFrame().split("\n");
    const y = rows.findIndex(line => line.includes(label));
    const index = navRef.itemRefs.findIndex(ref => ref?.screenY === y);
    expect(index).toBeGreaterThanOrEqual(0);
    setCursor(index);
    await settle();
    navRef.activateCurrentItem();
    await settle();
  };
  return { ...setup, row, activate, settle, openBuild, openTest, navRef };
}

test("a Jenkins build lists its stages straight under it, with names and marks only", async () => {
  const t = await renderJenkinsTab([pipeline]);
  try {
    const frame = t.captureCharFrame();
    // The failed build opened by itself; no Pipeline level, no stage count, no times, no test counts.
    expect(frame).not.toContain("Pipeline");
    expect(frame).not.toMatch(/\d+ stages?/);
    expect(frame).not.toMatch(/\b\d+s\b|\dm \d/);
    expect(frame).not.toContain("1,204");
    expect(t.row("├─ Checkout")).toMatch(/Checkout\s+✓\s*$/);
    expect(t.row("Unit tests")).toMatch(/Unit tests\s+✗\s*$/);
    expect(t.row("Publish image")).toMatch(/Publish image\s+–\s*$/);
    expect(t.row("Tests")).toMatch(/└─ Tests\s+✗\s*$/);
    // Every listed test failed: no mark of its own.
    expect(t.row("CartTest › roundsDiscountsToCents")).not.toContain("✗");
  } finally {
    t.renderer.destroy();
  }
});

test("the build's age stays put when its stages load", async () => {
  let release!: () => void;
  const t = await renderJenkinsTab([pipeline], new Promise<void>(resolve => (release = resolve)));
  try {
    const before = t.row("main #41");
    expect(t.captureCharFrame()).toContain("fetching stages...");
    release();
    await t.settle();
    expect(t.row("Unit tests")).toContain("✗");
    expect(t.row("main #41")).toBe(before);
  } finally {
    t.renderer.destroy();
  }
});

test("Enter on a stage opens the build's log at that stage; the whole build comes before the first stage", async () => {
  const t = await renderJenkinsTab([pipeline]);
  try {
    await t.activate("Unit tests");
    expect(t.openBuild).toHaveBeenLastCalledWith(run, pipeline, 2);
    await t.activate("├─ Checkout");
    expect(t.openBuild).toHaveBeenLastCalledWith(run, pipeline, 1);
    await t.activate("CartTest › roundsDiscountsToCents");
    expect(t.openTest).toHaveBeenLastCalledWith(run, [failedTest], 0);
  } finally {
    t.renderer.destroy();
  }
});

test("a build without stages has one Console row that opens the whole build", async () => {
  const t = await renderJenkinsTab([{ ...pipeline, steps: [], tests: undefined }]);
  try {
    expect(t.row("Console")).toMatch(/└─ Console\s+✗\s*$/);
    await t.activate("Console");
    expect(t.openBuild).toHaveBeenLastCalledWith(run, { ...pipeline, steps: [], tests: undefined }, 0);
  } finally {
    t.renderer.destroy();
  }
});

test("Reload asks again for a finished build's test report that could not be read", async () => {
  const { tests: _unknown, ...withoutReport } = pipeline;
  let fetches = 0;
  const t = await renderJenkinsTab(() => (++fetches === 1 ? [withoutReport] : [pipeline]));
  try {
    expect(t.captureCharFrame()).not.toContain("└─ Tests");
    await t.activate("Reload commit");
    expect(fetches).toBe(2);
    expect(t.row("Tests")).toMatch(/└─ Tests\s+✗\s*$/);
  } finally {
    t.renderer.destroy();
  }
});
