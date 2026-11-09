import { expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
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

async function renderSnyk(parentScan: SnykScanResult | null, filter?: string) {
  const [cursor, setCursor] = createSignal(0);
  const actions: (string | null)[] = [];
  const scanParent = mock(() => {});
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
        <box width={76} flexDirection="column">
          <SnykDetailTab
            scan={scanOf("a".repeat(40), [kept, added])}
            parent={{ sha: PARENT, scan: parentScan, onScan: scanParent }}
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
  return { ...setup, navRef, setCursor, settle, actions, scanParent, row, rows, indexOf };
}

test("vs parent: counts, new findings marked, and the parent's fixed ones in a folded FIXED section", async () => {
  const t = await renderSnyk(scanOf(PARENT, [kept, gone]));
  try {
    expect(t.row("vs parent")).toMatch(/vs parent bbbbbbb\s+1 new · 1 fixed/);
    expect(t.row("LODASH")).toMatch(/SNYK-JS-LODASH-1\s+new\s+7\.5/);
    expect(t.row("MINIMIST")).not.toMatch(/\bnew\b/);
    expect(t.row("FIXED")).toMatch(/▸ FIXED\s+1/);
    expect(t.indexOf("AXIOS")).toBe(-1);
    // Scan, vs parent, Copy, Group by, filter, HIGH, two findings, FIXED.
    t.setCursor(8);
    await t.settle();
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.indexOf("AXIOS")).toBeGreaterThan(t.indexOf("FIXED"));
  } finally {
    t.renderer.destroy();
  }
});

test("the filter words new and fixed pick by the diff", async () => {
  const onlyNew = await renderSnyk(scanOf(PARENT, [kept, gone]), "new");
  try {
    expect(onlyNew.indexOf("LODASH")).toBeGreaterThan(-1);
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

test("a parent without a scan says so, and Enter scans it", async () => {
  const t = await renderSnyk(null);
  try {
    expect(t.row("parent bbbbbbb")).toContain("parent bbbbbbb not scanned");
    t.setCursor(1);
    await t.settle();
    expect(t.actions.at(-1)).toBe("scan parent");
    t.navRef.activateCurrentItem();
    expect(t.scanParent).toHaveBeenCalledTimes(1);
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
