import { expect, spyOn, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { ActionsCountsColumn } from "../github-actions/graph-columns";
import type { GraphBadge } from "../provider";
import { SnykScanColumn } from "../snyk/graph-columns";
import type { SnykScanResult } from "../snyk/types";

const theme = createThemeState();

async function render(node: () => JSX.Element) {
  const app = createAppState(100, 0, 0);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <AppStateContext.Provider value={app}>
          <box flexDirection="row">{node()}</box>
        </AppStateContext.Provider>
      </ThemeContext.Provider>
    ),
    { width: 40, height: 2 },
  );
  await setup.flush();
  return setup;
}

const badge: GraphBadge = {
  sha: "a",
  badge: "fail",
  passCount: 2,
  failCount: 1,
  runningCount: 0,
  unknownCount: 1,
  latestRunAt: "2026-01-01T00:00:00Z",
  latestStatus: "fail",
};

const spanFor = (setup: Awaited<ReturnType<typeof render>>, text: string) =>
  setup.captureSpans().lines[0]?.spans.find(span => span.text.includes(text));

test("CI chips show a neutral count, and dimmed rows mute every chip", async () => {
  const bright = await render(() => <ActionsCountsColumn badge={badge} active={false} dimmed={false} width={15} />);
  try {
    expect(bright.captureCharFrame()).toContain(" 1   1   2 ");
    expect(spanFor(bright, " 1 ")?.bg).toEqual(RGBA.fromHex(theme.theme().error));
  } finally {
    bright.renderer.destroy();
  }
  const dimmed = await render(() => <ActionsCountsColumn badge={badge} active={false} dimmed width={15} />);
  try {
    for (const span of dimmed.captureSpans().lines[0]?.spans.filter(span => /\d/.test(span.text)) ?? []) {
      expect(span.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    }
  } finally {
    dimmed.renderer.destroy();
  }
});

const scan = (partial: boolean): SnykScanResult => ({
  sha: "a",
  scannedAt: "2026-01-01T00:00:00Z",
  includesDev: true,
  dependencyProjects: [],
  counts: { critical: 0, high: 0, medium: 0, low: 0 },
  findings: [],
  partial,
});

test("a partial Snyk scan adds a warning ? after its time; a scan in progress says scanning...", async () => {
  const partial = await render(() => (
    <SnykScanColumn scan={scan(true)} scanning={false} active={false} dimmed={false} width={11} />
  ));
  try {
    expect(spanFor(partial, "?")?.fg).toEqual(RGBA.fromHex(theme.theme().warning));
  } finally {
    partial.renderer.destroy();
  }
  const clean = await render(() => (
    <SnykScanColumn scan={scan(false)} scanning={false} active={false} dimmed={false} width={11} />
  ));
  try {
    expect(clean.captureCharFrame()).not.toContain("?");
  } finally {
    clean.renderer.destroy();
  }
  const scanning = await render(() => <SnykScanColumn scan={null} scanning active={false} dimmed={false} width={11} />);
  try {
    expect(scanning.captureCharFrame()).toContain("scanning...");
  } finally {
    scanning.renderer.destroy();
  }
});

test("Snyk's Last Scan fits an absolute same-year date with the partial marker", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(new Date(2026, 5, 30, 12).getTime());
  const old: SnykScanResult = { ...scan(true), scannedAt: new Date(2026, 5, 16, 12, 30).toISOString() };
  const setup = await render(() => (
    <SnykScanColumn scan={old} scanning={false} active={false} dimmed={false} width={15} />
  ));
  try {
    expect(setup.captureCharFrame()).toContain("16. Jun 12:30 ?");
  } finally {
    clock.mockRestore();
    setup.renderer.destroy();
  }
});
