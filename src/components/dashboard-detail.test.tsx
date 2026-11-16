import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { createThemeState, ThemeContext } from "../context/theme";
import type { DashboardEvent } from "../dashboard/events";
import { DashboardDetail } from "./dashboard-detail";

const SHA = "e6209dd7a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("the side panel shows the event, its facts, its commit and its provider's marks; a commit shows no marks", async () => {
  const run: DashboardEvent = {
    id: "run",
    app: "/shop",
    source: "github-actions",
    time: Date.parse("2026-03-02T10:52:00Z"),
    status: "fail",
    text: "CI #812 failed",
    sha: SHA,
    url: "https://github.com/demo/shop/actions/runs/1",
    branch: "feature/payments-retry-with-a-really-long-branch-name",
    facts: [
      { label: "Workflow", value: "CI" },
      { label: "Duration", value: "11m 30s" },
    ],
  };
  const { branch: _branch, ...unbranched } = run;
  const commit: DashboardEvent = {
    ...unbranched,
    id: "commit",
    source: "git",
    status: null,
    text: "feat(api): health",
  };
  const [event, setEvent] = createSignal<DashboardEvent | null>(run);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardDetail
          event={event}
          appName={() => "shop"}
          loadCommit={async () => ({
            author: "Demo Dev",
            email: "demo.dev@demo.invalid",
            date: "2026-03-02T09:20:00Z",
            subject: "feat(api): health",
            body: "",
          })}
        />
      </ThemeContext.Provider>
    ),
    { width: 60, height: 30 },
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("GitHub");
    expect(frame).toContain("✗ CI #812 failed");
    for (const text of [
      "Workflow",
      "11m 30s",
      "Commit",
      SHA,
      "Subject",
      "feat(api): health",
      "Demo Dev <demo.dev@demo.invalid>",
    ])
      expect(frame).toContain(text);
    expect(frame).toMatch(/✓ passed\s+● running\s+✗ failed/);
    // The branch, whole, above its commit.
    expect(frame.indexOf("Branch")).toBeGreaterThan(frame.indexOf("11m 30s"));
    expect(frame.indexOf("Branch")).toBeLessThan(frame.indexOf("Commit"));
    expect(frame.replace(/\s+/g, "")).toContain("feature/payments-retry-with-a-really-long-branch-name");
    setEvent(commit);
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Git");
    expect(frame).not.toContain("✓ passed");
    expect(frame).not.toContain("Branch");
    setEvent(null);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No event selected");
  } finally {
    setup.renderer.destroy();
  }
});

test("the first row shows the event's commit in the graph, on a click", async () => {
  const run: DashboardEvent = {
    id: "run",
    app: "/shop",
    source: "github-actions",
    time: Date.parse("2026-03-02T10:52:00Z"),
    status: "fail",
    text: "CI #812 failed",
    sha: SHA,
  };
  const [event, setEvent] = createSignal<DashboardEvent | null>(run);
  const onShowInGraph = mock(() => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardDetail
          event={event}
          appName={() => "shop"}
          loadCommit={async () => null}
          onShowInGraph={onShowInGraph}
          mouseEnabled={() => true}
        />
      </ThemeContext.Provider>
    ),
    { width: 60, height: 20, useMouse: true },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("Show in graph"));
    const title = lines.findIndex(line => line.includes("CI #812 failed"));
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(title);
    expect(lines[y]).toMatch(/Show in graph\s+e6209dd\s*$/);
    await setup.mockMouse.click(4, y, MouseButtons.LEFT);
    expect(onShowInGraph).toHaveBeenCalledTimes(1);
    setEvent(null);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Show in graph");
  } finally {
    setup.renderer.destroy();
  }
});

test("a scan's headline wraps between its parts, never inside a count, and colors its counts like the row", async () => {
  const scan: DashboardEvent = {
    id: "scan",
    app: "/shop",
    source: "snyk",
    time: Date.parse("2026-03-02T10:52:00Z"),
    status: "fail",
    severity: "critical",
    counts: { critical: 1, high: 3, medium: 0, low: 0 },
    text: "scan · 4 vulnerabilities · 1 critical · 3 high · 0 medium · 0 low",
    sha: SHA,
  };
  const themeState = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={themeState}>
        <DashboardDetail event={() => scan} appName={() => "shop"} />
      </ThemeContext.Provider>
    ),
    { width: 58, height: 20 },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const first = lines.findIndex(line => line.includes("▲ scan"));
    const headline = lines.slice(first, first + 3).join(" ");
    for (const part of ["4 vulnerabilities", "1 critical", "3 high", "0 medium", "0 low"])
      expect(headline.replace(/\s+/g, " ")).toContain(part);
    // At this width the headline needs two lines: it breaks after a part, not between `0` and `medium`.
    expect(lines[first + 1]?.trim()).not.toBe("");
    for (const line of lines.slice(first, first + 3)) expect(line.trimEnd()).not.toMatch(/\d$/);
    const theme = themeState.theme();
    const fg = (label: string) =>
      setup
        .captureSpans()
        .lines.flatMap(line => line.spans)
        .find(span => span.text.includes(label))?.fg;
    expect(fg("critical")).toEqual(RGBA.fromHex(theme.severityCritical));
    expect(fg("high")).toEqual(RGBA.fromHex(theme.severityHigh));
  } finally {
    setup.renderer.destroy();
  }
});
