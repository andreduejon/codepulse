import { expect, mock, test } from "bun:test";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createRoot, createSignal } from "solid-js";
import { createThemeState, ThemeContext } from "../context/theme";
import type { DashboardEvent } from "../dashboard/events";
import { useDashboard } from "../dashboard/use-dashboard";
import { DashboardView } from "./dashboard-view";

const NOW = new Date(2026, 2, 2, 11, 0).getTime();
const SHA = "e6209dd7a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("the open app's rope, each event a knot on it, with Commit, Time and Event; a click selects, a second opens", async () => {
  const events: DashboardEvent[] = [
    {
      id: "a",
      app: "/shop",
      source: "github-actions",
      time: new Date(2026, 2, 2, 10, 52).getTime(),
      status: "fail",
      text: "CI #812 failed",
      sha: SHA,
    },
    {
      id: "b",
      app: "/shop",
      source: "git",
      time: new Date(2026, 2, 2, 10, 12).getTime(),
      status: null,
      text: "fix(cart): round totals",
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
  const onActivate = mock(() => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <DashboardView dashboard={dashboard} onActivate={onActivate} now={() => NOW} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 16, useMouse: true },
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    expect(lines.some(line => /Graph\s+Commit\s+Time\s+Event/.test(line))).toBe(true);
    expect(lines.some(line => /\bApp\b/.test(line))).toBe(false);
    // A new day is a divider line across the table, with the day in it.
    expect(lines.find(line => line.includes("Today"))).toMatch(/^\s*│\s+── Today · Mon, Mar 2 ─{20,}\s*$/);
    // The commit has its own column, like in the graph: the event's text is only what happened.
    expect(lines.find(line => line.includes("CI #812"))).toMatch(/^\s*█\s+e6209dd\s+10:52\s+✗ CI #812 failed\s*$/);
    expect(lines.find(line => line.includes("round totals"))).toMatch(
      /^\s*█\s+e6209dd\s+10:12\s+fix\(cart\): round totals\s*$/,
    );
    const y = lines.findIndex(line => line.includes("round totals"));
    await setup.mockMouse.click(30, y, MouseButtons.LEFT);
    expect(dashboard.rows()[dashboard.cursor()]).toMatchObject({ kind: "event", event: { id: "b" } });
    expect(onActivate).not.toHaveBeenCalled();
    await setup.mockMouse.click(30, y, MouseButtons.LEFT);
    expect(onActivate).toHaveBeenCalledTimes(1);
  } finally {
    setup.renderer.destroy();
  }
});
