/**
 * One bench scenario, in a process of its own so its memory is its own. Started by run.ts with the bench's home and
 * repositories; prints each measurement as a `BENCH {json}` line.
 */
import { heapStats } from "bun:jsc";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createComponent, createSignal, Show } from "solid-js";
import App from "../../src/app";
import GraphView from "../../src/components/graph";
import { AppStateContext, createAppState } from "../../src/context/state";
import { createThemeState, ThemeContext } from "../../src/context/theme";
import { loadAppEvents } from "../../src/dashboard/load";
import { buildGraph, getMaxGraphColumns } from "../../src/git/graph";
import {
  getBranches,
  getCommits,
  getCurrentBranch,
  getRemoteUrl,
  getStashList,
  getTagDetails,
} from "../../src/git/repo";
import { getWorkingTreeStatus } from "../../src/git/repo-status";
import type { Commit } from "../../src/git/types";
import { startupProps } from "../../src/main";
import JobLogDialog from "../../src/providers/shared/job-log-dialog";
import { persistMergedSnapshots, ShaSqliteCache } from "../../src/providers/shared/sha-sqlite-cache";
import { newestSubject } from "./repo";

export interface BenchRepos {
  big: string;
  switching: string[];
}

type TestSetup = Awaited<ReturnType<typeof testRender>>;

const repos = JSON.parse(process.env.CODEPULSE_BENCH_REPOS ?? "{}") as BenchRepos;
const WIDTH = 200;
const HEIGHT = 50;

function report(name: string, value: number, unit: "ms" | "MB" | "count") {
  const rounded = unit === "count" ? value : Math.round(value * 10) / 10;
  console.log(`BENCH ${JSON.stringify({ name, value: rounded, unit })}`);
}

/** Memory after a full collection: the process (with OpenTUI's native buffers) and the JavaScript heap. */
function memory(): { rss: number; heap: number } {
  Bun.gc(true);
  return { rss: process.memoryUsage().rss / 2 ** 20, heap: heapStats().heapSize / 2 ** 20 };
}

function reportMemory(name: string) {
  const { rss, heap } = memory();
  report(`${name}: process memory`, rss, "MB");
  report(`${name}: JavaScript heap`, heap, "MB");
  return { rss, heap };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function timed(runs: number, work: () => unknown): Promise<number> {
  const times: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    await work();
    times.push(performance.now() - start);
  }
  return median(times);
}

/** Renders until the screen satisfies `done`; the time it took. */
async function until(setup: TestSetup, done: (screen: string) => boolean, what: string, limitMs = 60_000) {
  const start = performance.now();
  for (;;) {
    await setup.renderOnce();
    if (done(setup.captureCharFrame())) return performance.now() - start;
    if (performance.now() - start > limitMs) {
      const screen = setup.captureCharFrame();
      throw new Error(`bench: ${what} did not happen within ${limitMs} ms. The screen:\n${screen}`);
    }
    await Bun.sleep(1);
  }
}

/** Mean time of `count` key presses, each rendered. */
async function perKey(setup: TestSetup, key: string, count: number): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    setup.mockInput.pressKey(key);
    await setup.renderOnce();
  }
  return (performance.now() - start) / count;
}

const loadedRows = (screen: string) => Number(/(\d+) commits/.exec(screen)?.[1] ?? 0);

async function startApp(repo: string) {
  CliRenderer.prototype.setTerminalTitle = () => {};
  const props = await startupProps(["bun", "codepulse", repo]);
  const start = performance.now();
  const setup = await testRender(() => <App {...props} />, { width: WIDTH, height: HEIGHT });
  return { setup, start };
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

/** Git reads, graph building, the Dashboard's read and SQLite, without the UI. */
async function functions() {
  const repo = repos.big;
  for (const count of [200, 2_000, 20_000]) {
    report(`git log, ${count} commits`, await timed(3, () => getCommits(repo, { all: true, maxCount: count })), "ms");
    const commits = await getCommits(repo, { all: true, maxCount: count });
    report(`graph build, ${count} commits`, await timed(5, () => buildGraph(commits)), "ms");
  }
  for (const count of [200, 2_000]) {
    const refresh = () =>
      Promise.all([
        getCommits(repo, { all: true, maxCount: count }),
        getBranches(repo),
        getCurrentBranch(repo),
        getRemoteUrl(repo),
        getTagDetails(repo),
        getStashList(repo),
        getWorkingTreeStatus(repo),
      ]);
    report(`refresh Git reads, ${count} commits loaded`, await timed(5, refresh), "ms");
  }

  const cacheRoot = mkdtempSync(join(tmpdir(), "codepulse-bench-cache-"));
  const since = Date.now() - 7 * 86_400_000;
  report("Dashboard read, 7 days", await timed(3, () => loadAppEvents(repo, { since, cacheRoot })), "ms");
  report("Dashboard read, 7 days: events", (await loadAppEvents(repo, { since, cacheRoot })).length, "count");

  type Entry = { sha: string; runs: Record<string, unknown>[] };
  const cache = new ShaSqliteCache<Entry>({
    provider: "bench",
    root: cacheRoot,
    maxEntries: 500,
    isEntry: (value): value is Entry => typeof value === "object" && value !== null,
    invalidMessage: "bench entry",
  });
  const commits = await getCommits(repo, { all: true, maxCount: 200 });
  const entry = (sha: string): Entry => ({
    sha,
    runs: Array.from({ length: 5 }, (_, run) => ({
      id: run,
      name: `CI ${run}`,
      status: "completed",
      conclusion: "success",
      headSha: sha,
      headBranch: "main",
      runNumber: 800 + run,
      url: `https://github.com/bench/big/actions/runs/${run}`,
      updatedAt: "2026-03-02T10:00:00Z",
    })),
  });
  const writes = await timed(1, async () => {
    for (const commit of commits) await cache.write(repo, entry(commit.hash));
  });
  report("SQLite write, one entry (of 200 in a row)", writes / commits.length, "ms");
  report("SQLite read every entry (200)", await timed(5, () => cache.peekAll(repo)), "ms");
  // A fetch's save: every commit at once, as the providers save (a new run on each, so every entry changes).
  let round = 0;
  const save = await timed(3, () => {
    round++;
    return persistMergedSnapshots(
      cache,
      repo,
      commits.map(commit => commit.hash),
      () => true,
      () => [round],
      (sha, existing, incoming) => ({ sha, runs: [...(existing?.runs ?? []), { id: incoming[0] }] }),
    );
  });
  report("SQLite save of a fetch, 200 commits at once", save, "ms");
}

/** The graph view on its own: mounting rows, a refresh that brings one new commit, cursor moves, retained memory. */
async function graph() {
  const all = await getCommits(repos.big, { all: true, maxCount: 2_001 });
  const fresh = all[0] as Commit;
  const commits = all.slice(1);
  let app!: ReturnType<typeof createAppState>;
  const setup = await testRender(
    () => {
      app = createAppState(200, 0, 0);
      app.actions.setLoading(false);
      app.actions.setHasMore(false);
      return createComponent(ThemeContext.Provider, {
        value: createThemeState(),
        get children() {
          return createComponent(AppStateContext.Provider, {
            value: app,
            get children() {
              return createComponent(GraphView, {});
            },
          });
        },
      });
    },
    { width: WIDTH, height: HEIGHT },
  );
  const show = async (list: Commit[]) => {
    const rows = buildGraph(list);
    const start = performance.now();
    app.actions.setCommits(list);
    app.actions.setGraphRows(rows);
    app.actions.setMaxGraphColumns(getMaxGraphColumns(rows));
    await setup.renderOnce();
    return performance.now() - start;
  };
  const base = memory();
  for (const count of [200, 1_000, 2_000]) {
    await show([]);
    const before = memory();
    report(`graph mount, ${count} rows`, await show(commits.slice(0, count)), "ms");
    const after = memory();
    report(
      `graph mount, ${count} rows: JavaScript heap per 1,000 rows`,
      ((after.heap - before.heap) * 1_000) / count,
      "MB",
    );
  }

  // A refresh that brings one new commit, with 1,000 rows loaded: the rows are built again.
  const refreshes: number[] = [];
  for (let run = 0; run < 5; run++) {
    await show(commits.slice(0, 1_000));
    refreshes.push(await show([fresh, ...commits.slice(0, 1_000)]));
  }
  report("graph refresh with one new commit, 1,000 rows", median(refreshes), "ms");

  app.actions.setCursorIndex(0);
  const cursor = await timed(1, async () => {
    for (let i = 1; i <= 100; i++) {
      app.actions.setCursorIndex(i);
      await setup.renderOnce();
    }
  });
  report("graph cursor move, 1,000 rows", cursor / 100, "ms");

  // Twenty refreshes, then back to the same rows: what stays is retained.
  await show(commits.slice(0, 1_000));
  const steady = memory();
  for (let i = 0; i < 20; i++) await show(i % 2 === 0 ? [fresh, ...commits.slice(0, 1_000)] : commits.slice(0, 1_000));
  await show(commits.slice(0, 1_000));
  const later = memory();
  report("graph, 20 refreshes: JavaScript heap retained", later.heap - steady.heap, "MB");
  report("graph, baseline before rows: JavaScript heap", base.heap, "MB");
  setup.renderer.destroy();
}

/** The whole app on the big repository: startup, keys, pages of history. */
async function app() {
  const { setup, start } = await startApp(repos.big);
  await until(setup, screen => screen.includes(newestSubject("big")) && loadedRows(screen) > 0, "the graph");
  report("app startup until the graph shows", performance.now() - start, "ms");
  reportMemory("app after startup (200 rows)");
  report("app key j, graph", await perKey(setup, "j", 100), "ms");
  report("app key k, graph", await perKey(setup, "k", 100), "ms");

  const pages: number[] = [];
  for (let page = 0; page < 5; page++) {
    const rows = loadedRows(setup.captureCharFrame());
    setup.mockInput.pressKey("G");
    pages.push(await until(setup, screen => loadedRows(screen) > rows, "the next page"));
  }
  report("app page of 200 older commits", median(pages), "ms");
  report("app rows after 5 pages", loadedRows(setup.captureCharFrame()), "count");
  reportMemory("app after 5 pages");
  report("app key k, 1,200 rows", await perKey(setup, "k", 100), "ms");
  setup.renderer.destroy();
}

/** The Dashboard on the big repository: opening it and moving through its events. */
async function dashboard() {
  const { setup } = await startApp(repos.big);
  await until(setup, screen => screen.includes(newestSubject("big")), "the graph");
  const before = memory();
  const lines = setup.captureCharFrame().split("\n");
  const row = lines.findIndex(line => line.includes("Dashboard"));
  const column = lines[row]?.indexOf("Dashboard") ?? 0;
  const start = performance.now();
  await setup.mockMouse.click(column + 2, row);
  await until(setup, screen => /\d+ events/.test(screen), "the Dashboard's events");
  report("Dashboard open until its events show", performance.now() - start, "ms");
  report("Dashboard events", Number(/(\d+) events/.exec(setup.captureCharFrame())?.[1] ?? 0), "count");
  const after = reportMemory("Dashboard open");
  report("Dashboard open: JavaScript heap added", after.heap - before.heap, "MB");
  report("app key j, Dashboard", await perKey(setup, "j", 50), "ms");
  setup.renderer.destroy();
}

/** Switching between three apps of a group, again and again: time per switch and the memory that stays. */
async function switching() {
  const names = repos.switching.map((_, index) => `switch-${index}`);
  const { setup } = await startApp(repos.switching[0] ?? "");
  await until(setup, screen => screen.includes(newestSubject(names[0] ?? "")), "the first app");
  // The group doesn't wrap around: there and back, 0 → 1 → 2 → 1 → 0, three times.
  const route = [1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0];
  const times: number[] = [];
  let firstRound = 0;
  let at = 0;
  for (const [step, next] of route.entries()) {
    setup.mockInput.pressKey(next > at ? "ARROW_RIGHT" : "ARROW_LEFT", { shift: true });
    at = next;
    const name = names[next] ?? "";
    times.push(await until(setup, screen => screen.includes(newestSubject(name)), `switching to ${name}`));
    // Once each app was shown: what the later switches add stays.
    if (step === 3) firstRound = memory().heap;
  }
  report("app switch to another app of the group", median(times), "ms");
  const later = reportMemory("after 12 switches between 3 apps");
  report("switches 5 to 12: JavaScript heap added", later.heap - firstRound, "MB");
  setup.renderer.destroy();
}

/** A CI log of 20,000 lines: opening it, and the memory that stays after closing it ten times. */
async function log() {
  const lines = Array.from(
    { length: 20_000 },
    (_, i) =>
      `2026-03-02T09:${String(Math.floor(i / 600) % 60).padStart(2, "0")}:00Z step ${String(i).padStart(5, "0")}: building module ${i % 97}`,
  ).join("\n");
  const jobs = [{ id: 1, name: "build" }];
  const [open, setOpen] = createSignal(false);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <Show when={open()}>
          <JobLogDialog
            provider="github-actions"
            job={jobs[0] as { id: number; name: string }}
            jobs={jobs}
            run={{ name: "CI", runNumber: 812 }}
            fetchLog={async () => lines}
            onClose={() => setOpen(false)}
          />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: WIDTH, height: HEIGHT },
  );
  const cycle = async () => {
    setOpen(true);
    const time = await until(setup, screen => screen.includes("step 00000"), "the log");
    return time;
  };
  const before = memory();
  report("log of 20,000 lines: open until it shows", await cycle(), "ms");
  const opened = reportMemory("log of 20,000 lines open");
  report("log of 20,000 lines open: JavaScript heap added", opened.heap - before.heap, "MB");
  report("log of 20,000 lines: key G", await perKey(setup, "G", 1), "ms");
  setOpen(false);
  await setup.renderOnce();
  const closed = memory();
  for (let i = 0; i < 10; i++) {
    await cycle();
    setOpen(false);
    await setup.renderOnce();
  }
  const after = memory();
  report("log, 10 more opens and closes: JavaScript heap retained", after.heap - closed.heap, "MB");
  setup.renderer.destroy();
}

const scenarios: Record<string, () => Promise<void>> = { functions, graph, app, dashboard, switching, log };
const name = process.argv[2] ?? "";
const scenario = scenarios[name];
if (!scenario) {
  console.error(`bench: no scenario ${name}; one of ${Object.keys(scenarios).join(", ")}`);
  process.exit(2);
}
try {
  await scenario();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
