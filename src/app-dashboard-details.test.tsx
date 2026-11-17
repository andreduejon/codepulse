import { expect, mock, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppContent } from "./app-content";
import * as config from "./config";
import * as configWrite from "./config-write";
import type { AppActions, AppState } from "./context/state";
import { createThemeState } from "./context/theme";
import type { CodepulseConfig } from "./core/settings/config";
import type { DashboardEvent } from "./dashboard/events";
import * as dashboardLoad from "./dashboard/load";
import { buildGraph } from "./git/graph";
import * as dataLoader from "./hooks/use-data-loader";
import * as detailLoader from "./hooks/use-detail-loader";
import * as snykHook from "./providers/snyk/use-snyk";
import * as openUrlModule from "./utils/open-url";

/** Every provider turned on, without a token (the dashboard leaves out a turned-off provider's events). */
const NO_TOKEN = "CODEPULSE_TEST_NO_TOKEN";
const PROVIDERS_ON: CodepulseConfig = {
  providers: {
    github: { enabled: true, tokenEnvVar: NO_TOKEN },
    jenkins: { enabled: true, tokenEnvVar: NO_TOKEN },
    openshift: { enabled: true, tokenEnvVar: NO_TOKEN },
    snyk: { enabled: true, tokenEnvVar: NO_TOKEN },
  },
};

test("in the compact layout, Enter on a dashboard event opens its details with its provider's tab, and s shows it there", async () => {
  const repo = resolve("/repo/compact-dashboard");
  let app: { state: AppState; actions: AppActions } | undefined;
  const commits = ["a".repeat(40), "b".repeat(40)].map((hash, index) => ({
    hash,
    shortHash: hash.slice(0, 7),
    parents: index === 0 ? ["b".repeat(40)] : [],
    subject: index === 0 ? "head commit" : "older commit",
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-10-13T10:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-10-13T10:00:00Z",
    refs: [],
  }));
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: PROVIDERS_ON, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([
      {
        id: "github-actions:7",
        app: repo,
        source: "github-actions",
        time: Date.now() - 60_000,
        status: "fail",
        text: "CI #812 failed",
        sha: "b".repeat(40),
        url: "https://example.invalid/runs/7",
        facts: [{ label: "Workflow", value: "CI" }],
      },
    ]),
    spyOn(dashboardLoad, "loadCommitInfo").mockResolvedValue(null),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits(commits);
      options.actions.setGraphRows(buildGraph(commits));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(
      () => (
        <AppContent
          repoPath={repo}
          startupMode={{ kind: "graph" }}
          themeState={createThemeState()}
          autoRefreshInterval={0}
          autoFetchInterval={0}
        />
      ),
      // Narrower than COMPACT_THRESHOLD_WIDTH: no side panel, details open as a dialog.
      { width: 110, height: 40, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    const frame = () => setup?.captureCharFrame() ?? "";
    app.actions.setActiveProviderView("dashboard");
    for (let tries = 0; tries < 20 && !frame().includes("CI #812 failed"); tries++) await setup.flush();
    expect(frame()).toContain("CI #812 failed");
    expect(frame()).toContain("enter details");
    expect(frame()).not.toContain("Workflow");

    // Enter: the event's details over the dashboard, with GitHub's own tab, which has the keyboard.
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(frame()).toContain("esc close");
    expect(frame()).toContain("Show in GitHub");
    expect(frame()).toContain("s show in GitHub");
    expect(frame()).not.toContain("Workflow");
    expect(app.state.detailActiveTab()).toBe("github-actions");
    expect(app.state.detailFocused()).toBe(true);
    expect(app.state.activeProviderView()).toBe("dashboard");

    // Esc: back to the dashboard, whose events have the keyboard again.
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(frame()).not.toContain("esc close");
    expect(app.state.activeProviderView()).toBe("dashboard");
    expect(app.state.detailFocused()).toBe(false);

    // Enter, then s: the event's commit in its provider's view (GitHub is off here: Git), with the details dialog.
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    setup.mockInput.pressKey("s");
    for (let tries = 0; tries < 20 && app.state.activeProviderView() === "dashboard"; tries++) await setup.flush();
    expect(app.state.activeProviderView()).toBe("github-actions");
    expect(app.state.cursorIndex()).toBe(1);
    await setup.flush();
    expect(frame()).toContain("esc close");
    expect(frame()).not.toContain("Show in GitHub");
    // The details dialog has the keyboard, as when Enter opens it in the graph.
    expect(app.state.detailFocused()).toBe(true);
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});

test("beside the events, → gives the provider's tab the keyboard: ←/→ between its tabs, ← on the first back out", async () => {
  const repo = resolve("/repo/wide-dashboard");
  let app: { state: AppState; actions: AppActions } | undefined;
  const sha = "c".repeat(40);
  const commits = [
    {
      hash: sha,
      shortHash: sha.slice(0, 7),
      parents: [],
      subject: "scanned commit",
      body: "",
      author: "Author",
      authorEmail: "author@example.com",
      authorDate: "2026-10-13T10:00:00Z",
      committer: "Author",
      committerEmail: "author@example.com",
      commitDate: "2026-10-13T10:00:00Z",
      refs: [],
    },
  ];
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: PROVIDERS_ON, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue([
      {
        id: "snyk:scan",
        app: repo,
        source: "snyk",
        time: Date.now() - 60_000,
        status: "fail",
        severity: "high",
        counts: { critical: 0, high: 1, medium: 0, low: 0 },
        text: "scan · 1 vulnerability · 0 critical · 1 high · 0 medium · 0 low",
        sha,
      },
    ]),
    spyOn(dashboardLoad, "loadCommitInfo").mockResolvedValue(null),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits(commits);
      options.actions.setGraphRows(buildGraph(commits));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(
      () => (
        <AppContent
          repoPath={repo}
          startupMode={{ kind: "graph" }}
          themeState={createThemeState()}
          autoRefreshInterval={0}
          autoFetchInterval={0}
        />
      ),
      { width: 200, height: 40, kittyKeyboard: true, useMouse: true },
    );
    await setup.flush();
    if (!app) throw new Error("App fixture did not initialize");
    const { state } = app;
    const frame = () => setup?.captureCharFrame() ?? "";
    const press = async (key: string) => {
      setup?.mockInput.pressKey(key);
      await setup?.flush();
    };
    app.actions.setActiveProviderView("dashboard");
    for (let tries = 0; tries < 20 && !frame().includes("1 vulnerability"); tries++) await setup.flush();
    expect(frame()).toMatch(/Vulnerabilities\s+Dependencies\s+Info/);
    expect(frame()).toContain("Show in Snyk");
    expect(state.detailFocused()).toBe(false);

    await press("ARROW_RIGHT");
    expect(state.detailFocused()).toBe(true);
    expect(state.detailActiveTab()).toBe("snyk");
    await press("ARROW_RIGHT");
    expect(state.detailActiveTab()).toBe("snyk-deps");
    // Info: the event's commit as the graph's Info tab shows it.
    await press("ARROW_RIGHT");
    expect(state.detailActiveTab()).toBe("info");
    expect(frame()).toContain(sha);
    expect(frame()).toContain("scanned commit");
    await press("ARROW_LEFT");
    await press("ARROW_LEFT");
    expect(state.detailActiveTab()).toBe("snyk");
    // ← on the first tab: the events have the keyboard again, on the same event. Esc does the same.
    await press("ARROW_LEFT");
    expect(state.detailFocused()).toBe(false);
    expect(state.activeProviderView()).toBe("dashboard");
    await press("ARROW_RIGHT");
    expect(state.detailFocused()).toBe(true);
    await press("ESCAPE");
    expect(state.detailFocused()).toBe(false);

    // Narrower while the tab has the keyboard: the event's own dialog, not the graph's details.
    await press("ARROW_RIGHT");
    setup.resize(120, 40);
    await setup.flush();
    expect(frame()).toContain("Show in Snyk");
    expect(frame()).toContain("esc close");
    setup.resize(200, 40);
    await setup.flush();
    await press("ESCAPE");
    expect(state.detailFocused()).toBe(false);

    // Enter on the event: its commit in its provider's view (Snyk), with the details focused.
    await press("RETURN");
    for (let tries = 0; tries < 20 && state.activeProviderView() === "dashboard"; tries++) await setup.flush();
    expect(state.activeProviderView()).toBe("snyk");
    expect(state.detailFocused()).toBe(true);
  } finally {
    await setup?.dispose();
    for (const spy of spies) spy.mockRestore();
  }
});

/** Codepulse on the dashboard of one app: its graph holds `shas`, the dashboard reads `events`. */
async function launchDashboard(opts: { width: number; shas: string[]; events: DashboardEvent[] }) {
  const repo = resolve("/repo/dashboard-helper");
  let app: { state: AppState; actions: AppActions } | undefined;
  const commits = opts.shas.map((hash, index) => ({
    hash,
    shortHash: hash.slice(0, 7),
    parents: index + 1 < opts.shas.length ? [opts.shas[index + 1] ?? ""] : [],
    subject: `commit ${index}`,
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-10-13T10:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-10-13T10:00:00Z",
    refs: [],
  }));
  const spies = [
    spyOn(configWrite, "backfillRepoConfig").mockImplementation(() => {}),
    spyOn(config, "loadConfig").mockReturnValue({ config: PROVIDERS_ON, warnings: [] }),
    spyOn(config, "getRepoDisplayConfig").mockReturnValue({}),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([{ path: repo }]),
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dashboardLoad, "loadAppEvents").mockResolvedValue(opts.events.map(event => ({ ...event, app: repo }))),
    spyOn(dashboardLoad, "loadCommitInfo").mockResolvedValue({
      author: "Old Author",
      email: "old@example.com",
      date: "2026-01-02T03:04:05Z",
      subject: "an old commit",
      body: "Its body.",
    }),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits(commits);
      options.actions.setGraphRows(buildGraph(commits));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  const setup = await testRender(
    () => (
      <AppContent
        repoPath={repo}
        startupMode={{ kind: "graph" }}
        themeState={createThemeState()}
        autoRefreshInterval={0}
        autoFetchInterval={0}
      />
    ),
    { width: opts.width, height: 40, kittyKeyboard: true, useMouse: true },
  );
  await setup.flush();
  if (!app) throw new Error("App fixture did not initialize");
  const frame = () => setup.captureCharFrame();
  app.actions.setActiveProviderView("dashboard");
  for (let tries = 0; tries < 20 && !opts.events.every(event => frame().includes(event.text)); tries++)
    await setup.flush();
  return {
    ...app,
    setup,
    frame,
    press: async (key: string) => {
      setup.mockInput.pressKey(key);
      await setup.flush();
    },
    dispose: async () => {
      await setup.dispose();
      for (const spy of spies) spy.mockRestore();
    },
  };
}

const OUTSIDE = "d".repeat(40);
const outsideEvent: DashboardEvent = {
  id: "github-actions:outside",
  app: "",
  source: "github-actions",
  time: Date.now() - 60_000,
  status: "fail",
  text: "CI #815 failed",
  sha: OUTSIDE,
};

test("Enter on an event whose commit the graph doesn't hold stays on the dashboard and says why", async () => {
  const d = await launchDashboard({ width: 200, shas: ["e".repeat(40)], events: [outsideEvent] });
  try {
    await d.press("RETURN");
    for (let tries = 0; tries < 5; tries++) await d.setup.flush();
    expect(d.state.activeProviderView()).toBe("dashboard");
    expect(d.frame()).toContain("dddddd");
    expect(d.frame()).toMatch(/not in the graph/);
  } finally {
    await d.dispose();
  }
});

test("Info for a commit the graph doesn't hold shows what Git reads: hash, author, date, subject and body", async () => {
  const d = await launchDashboard({ width: 200, shas: ["e".repeat(40)], events: [outsideEvent] });
  try {
    await d.press("ARROW_RIGHT");
    await d.press("ARROW_RIGHT");
    for (let tries = 0; tries < 5; tries++) await d.setup.flush();
    expect(d.state.detailActiveTab()).toBe("info");
    for (const text of [OUTSIDE, "Old Author <old@example.com>", "an old commit", "Its body."])
      expect(d.frame()).toContain(text);
  } finally {
    await d.dispose();
  }
});

test("in the compact dialog, o opens the row's own page when the row has one, the event's page otherwise", async () => {
  const opened = spyOn(openUrlModule, "openUrl").mockImplementation(() => {});
  const event: DashboardEvent = { ...outsideEvent, sha: "e".repeat(40), url: "https://example.invalid/runs/1" };
  const d = await launchDashboard({ width: 120, shas: ["e".repeat(40)], events: [event] });
  try {
    await d.press("RETURN");
    expect(d.frame()).toContain("esc close");
    // A row with its own page (a job): the tab opens it, not the event.
    d.actions.setDetailCursorShortcut({ key: "o", desc: "open" });
    await d.press("o");
    expect(opened).not.toHaveBeenCalledWith("https://example.invalid/runs/1");
    // A row without one: the event's page.
    d.actions.setDetailCursorShortcut(null);
    await d.press("o");
    expect(opened).toHaveBeenCalledWith("https://example.invalid/runs/1");
  } finally {
    opened.mockRestore();
    await d.dispose();
  }
});

test("a scan on the dashboard reads its cached result, also for a commit the graph doesn't hold", async () => {
  const read = mock(async (_sha: string) => {});
  const real = snykHook.useSnyk;
  const snyk = spyOn(snykHook, "useSnyk").mockImplementation(options => ({ ...real(options), readCachedScan: read }));
  const scan: DashboardEvent = { ...outsideEvent, id: "snyk:scan", source: "snyk", text: "scan · 0 vulnerabilities" };
  const d = await launchDashboard({ width: 200, shas: ["e".repeat(40)], events: [scan] });
  try {
    for (let tries = 0; tries < 5 && read.mock.calls.length === 0; tries++) await d.setup.flush();
    expect(read).toHaveBeenCalledWith(OUTSIDE);
  } finally {
    snyk.mockRestore();
    await d.dispose();
  }
});

test("a click on the selected event gives the event list the keyboard back, as a click on another one does", async () => {
  const event: DashboardEvent = { ...outsideEvent, sha: "e".repeat(40) };
  const d = await launchDashboard({ width: 200, shas: ["e".repeat(40)], events: [event] });
  try {
    await d.press("ARROW_RIGHT");
    expect(d.state.detailFocused()).toBe(true);
    const lines = d.frame().split("\n");
    const y = lines.findIndex(line => line.includes("CI #815 failed"));
    await d.setup.mockMouse.click(lines[y]?.indexOf("CI #815") ?? 0, y);
    await d.setup.flush();
    expect(d.state.detailFocused()).toBe(false);
  } finally {
    await d.dispose();
  }
});

test("in the compact dialog, the o open hint shows for a row with its own page and a click on it opens the row", async () => {
  const opened = spyOn(openUrlModule, "openUrl").mockImplementation(() => {});
  // An OpenShift build: the event has no page, its rows (a resource) can.
  const event: DashboardEvent = {
    ...outsideEvent,
    sha: "e".repeat(40),
    source: "openshift",
    text: "build shop-api-43 complete in shop-dev",
  };
  const d = await launchDashboard({ width: 120, shas: ["e".repeat(40)], events: [event] });
  try {
    await d.press("RETURN");
    const hint = () =>
      d
        .frame()
        .split("\n")
        .find(line => line.includes("show in OpenShift")) ?? "";
    expect(hint()).not.toContain("o open");
    d.actions.setDetailCursorShortcut({ key: "o", desc: "open" });
    await d.setup.flush();
    expect(hint()).toContain("o open");
    const lines = d.frame().split("\n");
    const y = lines.findIndex(line => line.includes("show in OpenShift"));
    await d.setup.mockMouse.click(lines[y]?.indexOf("o open") ?? 0, y);
    await d.setup.flush();
    // Not the event's page (it has none): the row's, through the tab.
    expect(opened).not.toHaveBeenCalled();
  } finally {
    opened.mockRestore();
    await d.dispose();
  }
});

test("in the compact dialog, s for a commit the graph doesn't hold says why and gives the event list the keyboard", async () => {
  const d = await launchDashboard({ width: 120, shas: ["e".repeat(40)], events: [outsideEvent] });
  try {
    await d.press("RETURN");
    expect(d.state.detailFocused()).toBe(true);
    await d.press("s");
    for (let tries = 0; tries < 5; tries++) await d.setup.flush();
    expect(d.state.activeProviderView()).toBe("dashboard");
    expect(d.frame()).toMatch(/not in the graph/);
    expect(d.state.detailFocused()).toBe(false);
  } finally {
    await d.dispose();
  }
});

test("Enter on Info for a commit outside the graph does nothing, also after Info of a commit in the graph", async () => {
  // Commits: Info is their only tab, so the graph's Info view is followed directly by the fallback.
  const inGraph: DashboardEvent = {
    ...outsideEvent,
    id: "git:inside",
    source: "git",
    sha: "e".repeat(40),
    text: "CI #9 passed",
  };
  const outside: DashboardEvent = { ...outsideEvent, id: "git:outside", source: "git" };
  const d = await launchDashboard({ width: 200, shas: ["e".repeat(40)], events: [inGraph, outside] });
  const copies = spyOn(Bun, "spawn");
  try {
    const select = async (text: string) => {
      const lines = d.frame().split("\n");
      const y = lines.findIndex(line => line.includes(text));
      await d.setup.mockMouse.click(lines[y]?.indexOf(text) ?? 0, y);
      await d.setup.flush();
    };
    // Info of the commit in the graph (the graph's own Info view), then of the one outside it.
    await select("CI #9 passed");
    await d.press("ARROW_RIGHT");
    expect(d.state.detailActiveTab()).toBe("info");
    await select("CI #815 failed");
    await d.press("ARROW_RIGHT");
    expect(d.state.detailActiveTab()).toBe("info");
    copies.mockClear();
    await d.press("RETURN");
    expect(copies).not.toHaveBeenCalled();
  } finally {
    copies.mockRestore();
    await d.dispose();
  }
});
