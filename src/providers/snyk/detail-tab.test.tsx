import { expect, mock, spyOn, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as clipboard from "../../hooks/use-clipboard";
import { SnykDetailTab } from "./detail-tab";
import { finding } from "./scan-diff.test";
import type { SnykFinding, SnykScanResult } from "./types";

const scanOf = (sha: string, findings: SnykFinding[]): SnykScanResult => ({
  sha,
  scannedAt: "2026-01-01T00:00:00Z",
  includesDev: true,
  dependencyProjects: [],
  counts: { critical: 0, high: findings.length, medium: 0, low: 0 },
  findings,
});

const kept = finding("SNYK-JS-MINIMIST-1", "minimist", "1.2.5");
const added = finding("SNYK-JS-LODASH-1", "lodash", "4.17.20");
const gone = finding("SNYK-JS-AXIOS-1", "axios", "0.21.0");
const PARENT = "b".repeat(40);

async function renderSnyk(
  baselineScan: SnykScanResult | null,
  filter?: string,
  stepsBack = 1,
  scan = scanOf("a".repeat(40), [kept, added]),
) {
  const [cursor, setCursor] = createSignal(0);
  const actions: (string | null)[] = [];
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={76} flexDirection="column">
          <SnykDetailTab
            scan={scan}
            baseline={baselineScan ? { sha: PARENT, scan: baselineScan, stepsBack } : null}
            onScan={() => {}}
            takePendingFilter={() => filter ?? null}
            contentWidth={76}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={action => actions.push(action)}
            setDetailCursorIndex={setCursor}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 80, height: 30 },
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  await settle();
  const rows = () => setup.captureCharFrame().split("\n");
  const row = (text: string) => rows().find(line => line.includes(text)) ?? "";
  const indexOf = (text: string) => rows().findIndex(line => line.includes(text));
  /** Colour of the first cell run that contains `text`. */
  const fgOf = (text: string) =>
    setup
      .captureSpans()
      .lines[indexOf(text)]?.spans.find(span => span.text.includes(text))
      ?.fg.toString();
  const color = (token: "foregroundMuted" | "severityHigh" | "backgroundElementActive") =>
    RGBA.fromHex(theme.theme()[token]).toString();
  /** The cell run holding `text` on the row that contains `rowText`. */
  const spanIn = (rowText: string, text: string) =>
    setup.captureSpans().lines[indexOf(rowText)]?.spans.find(span => span.text.includes(text));
  const fgIn = (rowText: string, text: string) => spanIn(rowText, text)?.fg.toString();
  const bgIn = (rowText: string, text: string) => spanIn(rowText, text)?.bg.toString();
  return { ...setup, navRef, setCursor, settle, actions, row, rows, indexOf, fgOf, color, fgIn, bgIn };
}

test("NEW and FIXED: folded trees after a blank line, compared with the parent; new findings keep their mark", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]));
  try {
    expect(t.row("NEW")).toMatch(/▸ NEW\s+vs parent bbbbbbb\s+1\s*$/);
    expect(t.row("FIXED")).toMatch(/▸ FIXED\s+vs parent bbbbbbb\s+1\s*$/);
    expect(t.rows()[t.indexOf("NEW") - 1]?.trim()).toBe("");
    expect(t.indexOf("FIXED")).toBe(t.indexOf("NEW") + 1);
    // The comparison lives in the two headings: no row of its own.
    expect(t.rows().filter(line => line.includes("vs parent"))).toHaveLength(2);
    expect(t.row("LODASH")).toMatch(/SNYK-JS-LODASH-1\s+new\s+7\.5/);
    expect(t.row("MINIMIST")).not.toMatch(/\bnew\b/);
    expect(t.indexOf("AXIOS")).toBe(-1);
    // Scan, Copy, Group by, filter, HIGH, two findings, NEW, FIXED.
    t.setCursor(7);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    const underNew = t.rows().findIndex((line, index) => index > t.indexOf("NEW") && line.includes("LODASH"));
    expect(underNew).toBe(t.indexOf("NEW") + 1);
    expect(t.rows()[underNew]).not.toMatch(/\bnew\b/);
    t.setCursor(9);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.indexOf("AXIOS")).toBeGreaterThan(t.indexOf("FIXED"));
  } finally {
    t.renderer.destroy();
  }
});

test("NEW and FIXED stay muted, also under the cursor, so the severities keep the attention", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]));
  try {
    expect(t.fgOf("NEW")).toBe(t.color("foregroundMuted"));
    expect(t.fgOf("FIXED")).toBe(t.color("foregroundMuted"));
    expect(t.fgOf("vs parent")).toBe(t.color("foregroundMuted"));
    t.setCursor(8);
    await t.settle();
    expect(t.fgOf("FIXED")).toBe(t.color("foregroundMuted"));
  } finally {
    t.renderer.destroy();
  }
});

test("under the cursor a severity, NEW or FIXED arrow takes its heading's colour; the row shade marks the cursor", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]));
  try {
    // Scan, Copy, Group by, filter, HIGH.
    t.setCursor(4);
    await t.settle();
    expect(t.fgIn("HIGH", "▾")).toBe(t.color("severityHigh"));
    expect(t.bgIn("HIGH", "HIGH")).toBe(t.color("backgroundElementActive"));
    // HIGH, two findings, NEW, FIXED.
    t.setCursor(8);
    await t.settle();
    expect(t.fgIn("FIXED", "▸")).toBe(t.color("foregroundMuted"));
    expect(t.bgIn("FIXED", "FIXED")).toBe(t.color("backgroundElementActive"));
  } finally {
    t.renderer.destroy();
  }
});

test("FIXED is muted when the filter leaves none of its fixes", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]), "minimist");
  try {
    expect(t.row("FIXED")).toMatch(/· FIXED/);
    expect(t.fgOf("FIXED")).toBe(t.color("foregroundMuted"));
  } finally {
    t.renderer.destroy();
  }
});

test("the filter words new and fixed show only that tree", async () => {
  const onlyNew = await renderSnyk(scanOf(PARENT, [kept, gone]), "new");
  try {
    expect(onlyNew.indexOf("LODASH")).toBeGreaterThan(onlyNew.indexOf("NEW"));
    expect(onlyNew.rows().filter(line => line.includes("LODASH"))).toHaveLength(1);
    expect(onlyNew.indexOf("MINIMIST")).toBe(-1);
    expect(onlyNew.indexOf("AXIOS")).toBe(-1);
  } finally {
    onlyNew.renderer.destroy();
  }
  const onlyFixed = await renderSnyk(scanOf(PARENT, [kept, gone]), "fixed");
  try {
    expect(onlyFixed.indexOf("LODASH")).toBe(-1);
    expect(onlyFixed.indexOf("AXIOS")).toBeGreaterThan(onlyFixed.indexOf("FIXED"));
  } finally {
    onlyFixed.renderer.destroy();
  }
});

test("with new or fixed, the filter counts that tree's findings, like its heading", async () => {
  const onlyNew = await renderSnyk(scanOf(PARENT, [kept, gone]), "new");
  try {
    expect(onlyNew.row("new ")).toMatch(/new\s+1\/1\s*$/);
  } finally {
    onlyNew.renderer.destroy();
  }
  const onlyFixed = await renderSnyk(scanOf(PARENT, [kept, gone]), "fixed");
  try {
    expect(onlyFixed.row("fixed ")).toMatch(/fixed\s+1\/1\s*$/);
  } finally {
    onlyFixed.renderer.destroy();
  }
});

test("a commit that fixed everything keeps the filter, so fixed can still be typed", async () => {
  const t = await renderSnyk(scanOf(PARENT, [gone]), "fixed", 1, scanOf("a".repeat(40), []));
  try {
    expect(t.indexOf("AXIOS")).toBeGreaterThan(t.indexOf("FIXED"));
    expect(t.row("fixed ")).toMatch(/fixed\s+1\/1\s*$/);
  } finally {
    t.renderer.destroy();
  }
});

test("no NEW and no FIXED against a partial scan that does not say which projects failed", async () => {
  const t = await renderSnyk({ ...scanOf(PARENT, [kept, gone]), partial: true, failedProjects: 1 });
  try {
    expect(t.indexOf("NEW")).toBe(-1);
    expect(t.indexOf("FIXED")).toBe(-1);
    expect(t.row("LODASH")).not.toMatch(/\bnew\b/);
  } finally {
    t.renderer.destroy();
  }
});

test("an older scanned commit stands in for an unscanned parent, and the headings say how far back", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]), undefined, 3);
  try {
    expect(t.row("NEW")).toMatch(/▸ NEW\s+vs bbbbbbb, 3 commits back\s+1\s*$/);
    expect(t.row("FIXED")).toMatch(/▸ FIXED\s+vs bbbbbbb, 3 commits back\s+1\s*$/);
  } finally {
    t.renderer.destroy();
  }
});

test("nothing changed still names the compared scan, with NEW and FIXED at 0", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, added]));
  try {
    expect(t.row("NEW")).toMatch(/· NEW\s+vs parent bbbbbbb\s+0\s*$/);
    expect(t.row("FIXED")).toMatch(/· FIXED\s+vs parent bbbbbbb\s+0\s*$/);
    expect(t.rows()[t.indexOf("NEW") - 1]?.trim()).toBe("");
  } finally {
    t.renderer.destroy();
  }
});

test("without a scanned commit to compare with there is no NEW, no FIXED and no parent row", async () => {
  const t = await renderSnyk(null);
  try {
    expect(t.indexOf("NEW")).toBe(-1);
    expect(t.indexOf("FIXED")).toBe(-1);
    expect(t.indexOf("parent")).toBe(-1);
    expect(t.row("LODASH")).not.toMatch(/\bnew\b/);
  } finally {
    t.renderer.destroy();
  }
});

test("a selected package row shows its full coordinate, scrolling when it does not fit", async () => {
  const transitive = finding(
    "SNYK-JAVA-X-1",
    "org.example.very.long.groupname:vulnerable-artifact-with-a-long-name",
    "1.0",
    {
      dependencyType: "transitive",
      dependencyPath: [
        "org.example:app@1.0",
        "org.example.parent:direct-lib@2.0",
        "org.example.very.long.groupname:vulnerable-artifact-with-a-long-name@1.0",
      ],
    },
  );
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
        <box width={50} flexDirection="column">
          <SnykDetailTab
            scan={scanOf("a".repeat(40), [transitive])}
            onScan={() => {}}
            contentWidth={50}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 54, height: 16 },
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  const row = () =>
    setup
      .captureCharFrame()
      .split("\n")
      .find(line => line.includes("└─ ▾")) ?? "";
  try {
    await settle();
    // Group by dependency (Rescan, Copy, Group by).
    setCursor(2);
    await settle();
    navRef.activateCurrentItem();
    await settle();
    expect(row()).toContain("vulnerable-artifact-with-a-long-name");
    expect(row()).not.toContain("org.example");
    // Rescan, Copy, Group by, filter, the group, then its package.
    setCursor(5);
    await settle();
    expect(row()).toContain("org.example.very.long.groupname:");
  } finally {
    setup.renderer.destroy();
  }
});

test("Copy JSON gives what the trees show: with fixed, the fixed findings and the scan they were in", async () => {
  const copy = mock((_text: string, _id: string) => {});
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  const t = await renderSnyk(scanOf(PARENT, [gone]), "fixed", 1, scanOf("a".repeat(40), []));
  try {
    t.setCursor(1);
    await t.settle();
    t.navRef.activateCurrentItem?.();
    const json = JSON.parse(copy.mock.calls[0]?.[0] ?? "{}");
    expect(json.findings).toEqual([]);
    expect(json.comparison).toEqual({ baseline: PARENT, new: [], fixed: [gone] });
  } finally {
    t.renderer.destroy();
    clipboardSpy.mockRestore();
  }
});
