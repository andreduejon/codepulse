import { expect, spyOn, test } from "bun:test";
import { RGBA, TextAttributes } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createRoot, createSignal } from "solid-js";
import { createThemeState, ThemeContext } from "../context/theme";
import type { DashboardEvent } from "../dashboard/events";
import { useDashboard } from "../dashboard/use-dashboard";
import * as dates from "../utils/date";
import { DashboardView } from "./dashboard-view";

const NOW = new Date(2026, 2, 2, 11, 0).getTime();
const SHA = "e6209dd7a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("the open app's rope, each event a knot on it, with Commit, Branch, Time and Event; a click selects, like the graph's", async () => {
  const events: DashboardEvent[] = [
    {
      id: "a",
      app: "/shop",
      source: "github-actions",
      time: new Date(2026, 2, 2, 10, 52).getTime(),
      status: "fail",
      text: "CI #812 failed",
      sha: SHA,
      branch: "feature/payments-retry-with-a-really-long-branch-name",
    },
    {
      id: "b",
      app: "/shop",
      source: "git",
      time: new Date(2026, 2, 2, 10, 12).getTime(),
      status: null,
      text: "fix(cart): round totals",
      sha: SHA,
      branch: "main",
    },
    {
      id: "c",
      app: "/shop",
      source: "snyk",
      time: new Date(2026, 2, 2, 10, 5).getTime(),
      status: "pass",
      text: "scan · 0 vulnerabilities · 0 critical · 0 high · 0 medium · 0 low",
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
      sha: SHA,
    },
  ];
  const [active] = createSignal(true);
  const dashboard = createRoot(() =>
    useDashboard({
      app: () => ({ path: "/shop", name: "shop" }),
      active,
      now: () => NOW,
      load: async app => events.filter(event => event.app === app),
    }),
  );
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardView dashboard={dashboard} now={() => NOW} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 16, useMouse: true },
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    expect(lines.some(line => /Graph\s+Commit\s+Branch\s+Time\s+Event/.test(line))).toBe(true);
    expect(lines.some(line => /\bApp\b/.test(line))).toBe(false);
    // A new day: the rope goes on, and a line runs from the Commit column to the end, the day where the times start.
    const day = lines.find(line => line.includes("Today")) ?? "";
    const event = lines.find(line => line.includes("CI #812")) ?? "";
    expect(day).toMatch(/^\s*│\s+─+ Today · Mon, Mar 2 ─{20,}$/);
    expect(day.indexOf("│")).toBe(event.indexOf("█"));
    expect(day.indexOf("─")).toBe(event.indexOf("e6209dd"));
    expect(day.indexOf("Today")).toBe(event.indexOf("10:52"));
    // The commit and its branch have their own columns: the event's text is only what happened. A long branch is cut.
    expect(lines.find(line => line.includes("CI #812"))).toMatch(
      /^\s*█\s+e6209dd\s+feature\/payments-re…\s+10:52\s+✗ CI #812 failed\s*$/,
    );
    const commit = lines.find(line => line.includes("round totals")) ?? "";
    expect(commit).toMatch(/^\s*█\s+e6209dd\s+main\s+10:12\s+fix\(cart\): round totals\s*$/);
    expect(commit.indexOf("main")).toBe(event.indexOf("feature/"));
    // A commit no branch holds leaves the column empty; the times still line up.
    const scan = lines.find(line => line.includes("scan ·")) ?? "";
    expect(scan).toMatch(
      /^\s*█\s+e6209dd\s+10:05\s+scan · 0 vulnerabilities.*0 low\s*$/, // cut in the middle at this width
    );
    expect(scan.indexOf("10:05")).toBe(event.indexOf("10:52"));
    const y = lines.findIndex(line => line.includes("round totals"));
    await setup.mockMouse.click(30, y, MouseButtons.LEFT);
    expect(dashboard.rows()[dashboard.cursor()]).toMatchObject({ kind: "event", event: { id: "b" } });
    // A second click opens nothing: the details' first row shows the event in the graph.
    await setup.mockMouse.click(30, y, MouseButtons.LEFT);
    expect(dashboard.rows()[dashboard.cursor()]).toMatchObject({ kind: "event", event: { id: "b" } });
  } finally {
    setup.renderer.destroy();
  }
});

test("with every provider that has events hidden, it says how to show them again", async () => {
  const events: DashboardEvent[] = [
    {
      id: "a",
      app: "/shop",
      source: "jenkins",
      time: new Date(2026, 2, 2, 10, 52).getTime(),
      status: "pass",
      text: "main #42 passed",
      sha: SHA,
    },
  ];
  const [active] = createSignal(true);
  const dashboard = createRoot(() =>
    useDashboard({
      app: () => ({ path: "/shop", name: "shop" }),
      active,
      now: () => NOW,
      load: async () => events,
    }),
  );
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardView dashboard={dashboard} now={() => NOW} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 12 },
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    dashboard.toggleSource("jenkins");
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Every event is hidden. Click a provider's badge to show its events.");
    expect(frame).not.toContain("Nothing happened");
  } finally {
    setup.renderer.destroy();
  }
});

test("a scan's counts each take their severity's color, and a severity without findings is muted", async () => {
  const counts = { critical: 1, high: 3, medium: 0, low: 2 };
  const scan: DashboardEvent = {
    id: "scan",
    app: "/shop",
    source: "snyk",
    time: new Date(2026, 2, 2, 10, 5).getTime(),
    status: "fail",
    severity: "critical",
    counts,
    text: "scan · 6 vulnerabilities · 1 critical · 3 high · 0 medium · 2 low",
    sha: SHA,
    branch: "main",
  };
  const [active] = createSignal(true);
  const dashboard = createRoot(() =>
    useDashboard({
      app: () => ({ path: "/shop", name: "shop" }),
      active,
      now: () => NOW,
      load: async () => [
        scan,
        {
          ...scan,
          id: "partial",
          time: scan.time - 60_000,
          severity: "medium",
          counts: { critical: 0, high: 0, medium: 1, low: 0 },
          partial: true,
          text: "scan · 1 vulnerability · 0 critical · 0 high · 1 medium · 0 low",
        },
      ],
    }),
  );
  const themeState = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={themeState}>
        <DashboardView dashboard={dashboard} now={() => NOW} />
      </ThemeContext.Provider>
    ),
    { width: 120, height: 10 },
  );
  try {
    await Bun.sleep(0);
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex(line => line.includes("6 vulnerabilities"));
    expect(lines[row]).toContain("▲ scan · 6 vulnerabilities · 1 critical · 3 high · 0 medium · 2 low");
    const theme = themeState.theme();
    const fg = (label: string) => setup.captureSpans().lines[row]?.spans.find(span => span.text.includes(label))?.fg;
    expect(fg("1 critical")).toEqual(RGBA.fromHex(theme.severityCritical));
    expect(fg("3 high")).toEqual(RGBA.fromHex(theme.severityHigh));
    expect(fg("0 medium")).toEqual(RGBA.fromHex(theme.foregroundMuted));
    expect(fg("2 low")).toEqual(RGBA.fromHex(theme.severityLow));
    // The selected row is in the dashboard's color, like a provider view's in its own; marks keep theirs.
    expect(fg("e6209dd")).toEqual(RGBA.fromHex(theme.dashboardBg));
    expect(fg("main")).toEqual(RGBA.fromHex(theme.dashboardBg));
    expect(fg("10:05")).toEqual(RGBA.fromHex(theme.dashboardBg));
    expect(fg("6 vulnerabilities")).toEqual(RGBA.fromHex(theme.dashboardBg));
    expect(fg("▲")).toEqual(RGBA.fromHex(theme.severityCritical));
    // And bold, as a selected row is in the graph and the provider views.
    const bold = (label: string, row: number) =>
      ((setup.captureSpans().lines[row]?.spans.find(span => span.text.includes(label))?.attributes ?? 0) &
        TextAttributes.BOLD) !==
      0;
    for (const label of ["e6209dd", "main", "10:05", "6 vulnerabilities", "1 critical"])
      expect(bold(label, row)).toBe(true);
    // A partial scan ends in Snyk's warning `?`.
    const partial =
      setup
        .captureCharFrame()
        .split("\n")
        .find(line => line.includes("1 vulnerability")) ?? "";
    expect(partial).toMatch(/scan · 1 vulnerability · 0 critical · 0 high · 1 medium · 0 low \?\s*$/);
    const partialRow = setup.captureCharFrame().split("\n").indexOf(partial);
    // Another row keeps its muted columns and plain text.
    const partialFg = (label: string) =>
      setup.captureSpans().lines[partialRow]?.spans.find(span => span.text.includes(label))?.fg;
    expect(partialFg("e6209dd")).toEqual(RGBA.fromHex(theme.foregroundMuted));
    expect(partialFg("1 vulnerability")).toEqual(RGBA.fromHex(theme.foreground));
    expect(bold("e6209dd", partialRow)).toBe(false);
    expect(bold("1 vulnerability", partialRow)).toBe(false);
    expect(setup.captureSpans().lines[partialRow]?.spans.find(span => span.text.trim() === "?")?.fg).toEqual(
      RGBA.fromHex(theme.warning),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("moving the cursor redraws the two rows it leaves and reaches, not every row", async () => {
  const time = new Date(2026, 2, 2, 10, 0).getTime();
  const events: DashboardEvent[] = Array.from({ length: 200 }, (_, index) => ({
    id: `e${index}`,
    app: "/shop",
    source: "git",
    time: time - index * 1_000,
    status: null,
    text: `commit ${index}`,
    sha: SHA,
    branch: "main",
  }));
  const [active] = createSignal(true);
  const dashboard = createRoot(() =>
    useDashboard({
      app: () => ({ path: "/shop", name: "shop" }),
      active,
      now: () => NOW,
      load: async () => events,
    }),
  );
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardView dashboard={dashboard} now={() => NOW} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 30 },
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    // Each event row that redraws writes its time again.
    const redrawn = spyOn(dates, "formatClock");
    dashboard.select(5);
    await setup.renderOnce();
    expect(redrawn.mock.calls.length).toBeLessThan(10);
    redrawn.mockRestore();
  } finally {
    setup.renderer.destroy();
  }
});
