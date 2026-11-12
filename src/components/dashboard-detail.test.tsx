import { expect, test } from "bun:test";
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
    facts: [
      { label: "Workflow", value: "CI" },
      { label: "Duration", value: "11m 30s" },
    ],
  };
  const commit: DashboardEvent = { ...run, id: "commit", source: "git", status: null, text: "feat(api): health" };
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
    expect(frame).toContain("GitHub Actions");
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
    setEvent(commit);
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Git");
    expect(frame).not.toContain("✓ passed");
    setEvent(null);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No event selected");
  } finally {
    setup.renderer.destroy();
  }
});
