import { expect, mock, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { batch, createSignal, Show } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import { resetRepeatNav } from "../../utils/keyboard-nav-utils";
import { SnykDependenciesTab } from "./deps-tab";
import type { SnykDependencyGraph, SnykDependencyProjectResult, SnykScanResult } from "./types";

function graphFixture(): SnykDependencyGraph {
  return {
    targetFile: "web/package.json",
    packageManager: "yarn",
    rootNodeId: "root",
    packages: [
      { id: "root-pkg", name: "fixture-app", version: "1.0.0" },
      { id: "parent-pkg", name: "parent", version: "1.0.0" },
      { id: "dev-pkg", name: "dev-only", version: "2.0.0" },
      { id: "unknown-pkg", name: "mystery", version: "3.0.0" },
      { id: "shared-pkg", name: "@fixture/shared", version: "4.0.0" },
      { id: "leaf-pkg", name: "leaf", version: "5.0.0" },
    ],
    nodes: [
      {
        nodeId: "root",
        pkgId: "root-pkg",
        deps: ["parent", "dev", "unknown"],
        scope: "unknown",
        referenceNodeId: null,
      },
      { nodeId: "parent", pkgId: "parent-pkg", deps: ["shared", "parent"], scope: "prod", referenceNodeId: null },
      { nodeId: "dev", pkgId: "dev-pkg", deps: ["shared:pruned"], scope: "dev", referenceNodeId: null },
      { nodeId: "unknown", pkgId: "unknown-pkg", deps: [], scope: "unknown", referenceNodeId: null },
      { nodeId: "shared", pkgId: "shared-pkg", deps: ["leaf"], scope: "prod", referenceNodeId: null },
      { nodeId: "shared:pruned", pkgId: "shared-pkg", deps: [], scope: "dev", referenceNodeId: "shared" },
      { nodeId: "leaf", pkgId: "leaf-pkg", deps: [], scope: "unknown", referenceNodeId: null },
    ],
  };
}

function scanFixture(): SnykScanResult {
  return {
    sha: "a".repeat(40),
    scannedAt: "2026-10-19T12:00:00Z",
    includesDev: true,
    dependencyProjects: [
      { targetFile: "web/bun.lock", packageManager: "bun", status: "scanned", graphs: [graphFixture()], reason: null },
    ],
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
}

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderDependencies(initial: SnykScanResult | null = scanFixture(), width = 110, mouseEnabled = true) {
  const theme = createThemeState();
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const [scan, setScan] = createSignal(initial);
  const [loading, setLoading] = createSignal(false);
  const [modal, setModal] = createSignal(false);
  const [mounted, setMounted] = createSignal(true);
  const onScan = mock(() => {});
  let app!: ReturnType<typeof createAppState>;
  const onMouseFocus = mock(() => app.actions.setDetailFocused(true));
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setDetailFocused(true);
      useKeyboard(event => {
        if (modal()) return;
        handleDetailKey(event, {
          ...app,
          dialog: () => "detail",
          getDetailScrollboxRef: () => undefined,
          detailNavRef: navRef,
        });
      });
      return (
        <ThemeContext.Provider value={theme}>
          <box width={width} flexDirection="column">
            <Show when={mounted()}>
              <SnykDependenciesTab
                scan={scan()}
                onScan={onScan}
                loading={loading()}
                contentWidth={width}
                mouseEnabled={mouseEnabled && !modal()}
                onMouseFocus={onMouseFocus}
                navRef={navRef}
                detailCursorIndex={app.state.detailCursorIndex}
                detailFocused={app.state.detailFocused}
                setDetailCursorIndex={app.actions.setDetailCursorIndex}
                setDetailCursorAction={app.actions.setDetailCursorAction}
              />
            </Show>
          </box>
        </ThemeContext.Provider>
      );
    },
    { width, height: 80, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const flush = () => setup.flush({ maxPasses: 20 });
  const frame = () => setup.captureCharFrame();
  const text = (label: string) => {
    const node = descendants(setup.renderer.root).find(
      node => node instanceof TextRenderable && node.plainText.includes(label),
    );
    if (!(node instanceof TextRenderable)) throw new Error(`Missing text: ${label}`);
    return node;
  };
  const index = (label: string) => {
    const element = label === "filter" ? input()?.parent : text(label).parent;
    const result = navRef.itemRefs.indexOf(element as Renderable);
    expect(result).toBeGreaterThanOrEqual(0);
    return result;
  };
  const point = (label: string) => {
    if (label === "filter") {
      const row = navRef.itemRefs[1];
      if (!row) throw new Error("Filter row missing.");
      return { x: row.x + 1, y: row.screenY };
    }
    const lines = frame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y].indexOf(label) + 1, y };
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await flush();
  };
  const key = async (name: string) => {
    resetRepeatNav();
    setup.mockInput.pressKey(name);
    await flush();
  };
  const input = () => descendants(setup.renderer.root).find(node => node instanceof InputRenderable);
  const type = async (value: string) => {
    await setup.mockInput.typeText(value);
    await flush();
  };
  const dispose = async () => {
    if (navRef.scrollTimer) clearTimeout(navRef.scrollTimer);
    await setup.dispose();
  };
  try {
    await flush();
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    ...setup,
    ...app,
    navRef,
    theme: theme.theme(),
    scan,
    setScan,
    setLoading,
    setModal,
    setMounted,
    onScan,
    onMouseFocus,
    flush,
    frame,
    text,
    index,
    point,
    click,
    key,
    input,
    type,
    dispose,
  };
}

test("dependency browser has an inline filter, folded file root, right-aligned dev flags and central navigation", async () => {
  const d = await renderDependencies();
  try {
    const lines = d.frame().split("\n");
    const scanLine = lines.findIndex(line => line.includes("Rescan commit"));
    expect(lines[scanLine + 1].trim()).toBe("");
    expect(lines[scanLine + 2]).toContain("Enter dependency filter...");
    expect(d.frame()).not.toContain("Filter:");
    expect(d.frame()).not.toContain("supported projects scanned");
    expect(d.frame()).not.toContain("Snapshot:");
    expect(d.frame()).not.toContain("2026-10-19");
    expect(d.frame()).not.toContain("dev/test");
    expect(d.frame()).not.toContain("[prod]");
    expect(d.frame()).not.toContain("[unknown]");
    expect(d.frame()).toContain("web/bun.lock (converted)");
    expect(d.frame()).toContain("parent@1.0.0");
    expect(d.frame()).toContain("mystery@3.0.0");
    expect(d.frame()).toContain("├");
    expect(d.frame()).toContain("└");
    const devLabel = d.text("dev-only@2.0.0");
    expect(devLabel.plainText).toBe("dev-only@2.0.0");
    const devFlag = devLabel.parent
      ?.getChildren()
      .find(node => node instanceof TextRenderable && node.plainText === " dev");
    expect(devFlag).toBeDefined();
    expect((devFlag?.x ?? 0) + (devFlag?.width ?? 0)).toBe(110);
    expect(devFlag?.x).toBeGreaterThanOrEqual(devLabel.x + devLabel.width);
    const devSpans = d.captureSpans().lines[d.point("dev-only@2.0.0").y]?.spans;
    expect(devSpans?.find(span => span.text.trim() === "dev")?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    expect(d.frame()).not.toContain("@fixture/shared");
    expect(d.navRef.itemCount).toBe(6);
    expect(d.navRef.itemRefs).toHaveLength(6);
    expect(d.navRef.itemRefs.every(ref => ref?.getChildren().length > 0)).toBe(true);
    expect(d.index("filter")).toBe(1);
    expect(d.index("web/bun.lock")).toBe(2);
    expect(d.index("parent@1.0.0")).toBe(3);
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorAction()).toBe("rescan");
    await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.state.detailCursorAction()).toBe("done");
    expect(d.input()?.focused).toBe(true);
    await d.key("RETURN");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorAction()).toBe("filter");
    await d.key("RETURN");
    expect(d.input()?.focused).toBe(true);
    expect(d.state.detailCursorAction()).toBe("done");
    await d.key("ESCAPE");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorAction()).toBe("filter");
    await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.state.detailCursorAction()).toBe("collapse");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(3);
    expect(d.frame()).not.toContain("parent@1.0.0");
    expect(d.frame()).not.toContain("\nscanned");
    expect(d.state.detailCursorAction()).toBe("expand");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(6);
    await d.key("ARROW_UP");
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.input()?.focused).toBe(true);
    await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(2);
    await d.key("ARROW_DOWN");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(8);
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(6);
    const leafIndex = d.index("mystery@3.0.0");
    d.actions.setDetailCursorIndex(leafIndex);
    await d.flush();
    expect(d.state.detailCursorAction()).toBeNull();
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(6);
    expect(d.onScan).not.toHaveBeenCalled();
    await d.key("ARROW_UP");
    expect(d.state.detailCursorIndex()).toBe(leafIndex - 1);
  } finally {
    await d.dispose();
  }
});

test("left-click focuses rows; hover, right-click and modal ownership do not activate them", async () => {
  const d = await renderDependencies();
  try {
    d.actions.setDetailFocused(false);
    await d.flush();
    const { x, y } = d.point("parent@1.0.0");
    await d.mockMouse.moveTo(x, y);
    await d.flush();
    let column = 0;
    const span = d.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
    expect(span?.bg).toEqual(RGBA.fromHex(d.theme.backgroundElement));
    expect(d.text("parent@1.0.0").selectable).toBe(false);
    await d.click("parent@1.0.0", MouseButtons.RIGHT);
    expect(d.navRef.itemCount).toBe(6);
    expect(d.onMouseFocus).not.toHaveBeenCalled();
    expect(d.state.detailFocused()).toBe(false);
    await d.click("parent@1.0.0");
    expect(d.onMouseFocus).toHaveBeenCalledTimes(1);
    expect(d.state.detailFocused()).toBe(true);
    expect(d.state.detailCursorIndex()).toBe(d.index("parent@1.0.0"));
    expect(d.frame()).toContain("@fixture/shared@4.0.0");
    const count = d.navRef.itemCount;
    const cursor = d.state.detailCursorIndex();
    d.setModal(true);
    await d.flush();
    expect(d.text("parent@1.0.0").selectable).toBe(true);
    await d.click("parent@1.0.0");
    await d.click("Rescan commit");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(count);
    expect(d.state.detailCursorIndex()).toBe(cursor);
    expect(d.onMouseFocus).toHaveBeenCalledTimes(1);
    expect(d.onScan).not.toHaveBeenCalled();
  } finally {
    await d.dispose();
  }
});

test("mouse actions are opt-in and a busy Scan row is inert without blocking cached tree inspection", async () => {
  const sidebar = await renderDependencies(scanFixture(), 110, false);
  try {
    expect(sidebar.text("parent@1.0.0").selectable).toBe(true);
    await sidebar.click("parent@1.0.0");
    await sidebar.click("Rescan commit");
    expect(sidebar.navRef.itemCount).toBe(6);
    expect(sidebar.state.detailCursorIndex()).toBe(0);
    expect(sidebar.onMouseFocus).not.toHaveBeenCalled();
    expect(sidebar.onScan).not.toHaveBeenCalled();
  } finally {
    await sidebar.dispose();
  }
  const d = await renderDependencies();
  try {
    d.actions.setDetailCursorIndex(d.index("parent@1.0.0"));
    d.setLoading(true);
    await d.flush();
    const cursor = d.state.detailCursorIndex();
    await d.click("Rescan commit");
    expect(d.state.detailCursorIndex()).toBe(cursor);
    expect(d.onMouseFocus).not.toHaveBeenCalled();
    d.actions.setDetailCursorIndex(0);
    await d.flush();
    expect(d.state.detailCursorAction()).toBeNull();
    await d.key("RETURN");
    expect(d.onScan).not.toHaveBeenCalled();
    await d.click("parent@1.0.0");
    expect(d.frame()).toContain("@fixture/shared@4.0.0");
    expect(d.state.detailCursorAction()).toBe("collapse");
    d.setLoading(false);
    await d.click("Rescan commit", MouseButtons.RIGHT);
    expect(d.onScan).not.toHaveBeenCalled();
    await d.click("Rescan commit");
    expect(d.onScan).toHaveBeenCalledTimes(1);
    expect(d.state.detailCursorAction()).toBe("rescan");
  } finally {
    await d.dispose();
  }
});

test("live filtering expands ancestors, preserves native typing and reports incomplete no-match coverage", async () => {
  const scan = scanFixture();
  const partial = graphFixture();
  partial.packageManager = "pnpm";
  partial.targetFile = "broken/package.json";
  partial.packages[0].name = "partial-app";
  const empty = graphFixture();
  empty.targetFile = "empty/package.json";
  empty.packages = empty.packages.slice(0, 1);
  empty.nodes = [{ ...empty.nodes[0], deps: [] }];
  const extra: SnykDependencyProjectResult[] = [
    {
      targetFile: "broken/pnpm-lock.yaml",
      packageManager: "pnpm",
      status: "failed",
      graphs: [partial],
      reason: "Graph extraction incomplete",
    },
    {
      targetFile: "skipped/yarn.lock",
      packageManager: "yarn",
      status: "skipped",
      graphs: [],
      reason: "Unsupported lockfile format",
    },
    { targetFile: "empty/yarn.lock", packageManager: "yarn", status: "scanned", graphs: [empty], reason: null },
  ];
  scan.dependencyProjects.push(...extra);
  const d = await renderDependencies(scan);
  try {
    expect(d.frame()).not.toContain("supported projects scanned");
    expect(d.text("broken/pnpm-lock.yaml").plainText).toContain("incomplete");
    expect(d.frame()).toContain("failed · Graph extraction incomplete");
    expect(d.frame()).toContain("skipped · Unsupported lockfile format");
    await d.click("broken/pnpm-lock.yaml");
    expect(d.state.detailCursorAction()).toBe("expand");
    expect(d.text("broken/pnpm-lock.yaml").plainText).toContain("incomplete");
    expect(d.frame()).toContain("failed · Graph extraction incomplete");
    await d.click("skipped/yarn.lock");
    expect(d.frame()).toContain("skipped · Unsupported lockfile format");
    expect(d.frame()).not.toContain("No supported dependency projects");
    expect(d.frame()).not.toContain("No dependencies");
    await d.click("filter");
    await d.type("leaf");
    const input = d.input();
    expect(input?.focused).toBe(true);
    expect(input?.value).toBe("leaf");
    expect(input?.cursorOffset).toBe(4);
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.frame()).toContain("parent@1.0.0");
    expect(d.frame()).toContain("@fixture/shared@4.0.0");
    expect(d.frame()).toContain("leaf@5.0.0");
    expect(d.frame()).not.toContain("mystery@3.0.0");
    expect(d.frame()).toContain("Graph extraction incomplete");
    expect(d.frame()).toContain("Unsupported lockfile format");
    await d.key("ARROW_LEFT");
    await d.type("x");
    expect(d.input()).toBe(input);
    expect(input?.value).toBe("leaxf");
    expect(input?.cursorOffset).toBe(4);
    expect(d.frame()).toContain("No matching dependencies · coverage incomplete");
    expect(d.frame()).toContain("failed · Graph extraction incomplete");
    expect(d.frame()).toContain("skipped · Unsupported lockfile format");
    await d.key("ESCAPE");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.frame()).toContain("leaxf");
    await d.key("RETURN");
    expect(d.input()?.value).toBe("leaxf");
    await d.key("RETURN");
    expect(d.input()?.focused).toBe(false);
    await d.key("ESCAPE");
    expect(d.frame()).not.toContain("No matching dependencies");
    await d.click("filter");
    const tab = d.state.detailActiveTab();
    await d.type("qmfjk:/@.-");
    expect(d.input()?.value).toBe("qmfjk:/@.-");
    expect(d.input()?.cursorOffset).toBe(10);
    expect(d.state.detailCursorIndex()).toBe(1);
    expect(d.state.detailActiveTab()).toBe(tab);
    expect(d.onScan).not.toHaveBeenCalled();
    await d.key("ESCAPE");
    await d.key("ESCAPE");
    await d.click("filter");
    await d.type("leaf");
    await d.click("web/bun.lock");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorIndex()).toBe(2);
    expect(d.state.detailCursorAction()).toBe("expand");
  } finally {
    await d.dispose();
  }
});

test("references expand canonical children with their own dev flag, cycles stop, and selected paths wrap", async () => {
  const d = await renderDependencies();
  try {
    await d.click("parent@1.0.0");
    expect(d.frame()).toContain("parent@1.0.0 ↩ cycle");
    await d.click("dev-only@2.0.0");
    const reference = d.text("@fixture/shared@4.0.0 ↪ reference");
    expect(
      reference.parent?.getChildren().some(node => node instanceof TextRenderable && node.plainText === " dev"),
    ).toBe(true);
    d.actions.setDetailCursorIndex(d.index("@fixture/shared@4.0.0 ↪ reference"));
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("expand");
    const beforeReference = d.navRef.itemCount;
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(beforeReference + 1);
    expect(d.frame()).toContain("leaf@5.0.0");
    const cycle = d.index("parent@1.0.0 ↩ cycle");
    d.actions.setDetailCursorIndex(cycle);
    await d.flush();
    const count = d.navRef.itemCount;
    expect(d.state.detailCursorAction()).toBeNull();
    d.navRef.activateCurrentItem();
    await d.flush();
    expect(d.navRef.itemCount).toBe(count);
    expect(d.text("Path:").plainText).toContain("fixture-app@1.0.0 → parent@1.0.0 → parent@1.0.0");
  } finally {
    await d.dispose();
  }
  const scan = scanFixture();
  const longName = "@fixture/a-very-long-transitive-dependency";
  scan.dependencyProjects[0].graphs[0].packages[5].name = longName;
  const narrow = await renderDependencies(scan, 20);
  try {
    for (const label of ["parent@1.0.0", "@fixture/shared@4.0.0"]) {
      narrow.actions.setDetailCursorIndex(narrow.index(label));
      narrow.navRef.activateCurrentItem();
      await narrow.flush();
    }
    narrow.actions.setDetailCursorIndex(narrow.index(`${longName}@5.0.0`));
    await narrow.flush();
    const path = `Path: fixture-app@1.0.0 → parent@1.0.0 → @fixture/shared@4.0.0 → ${longName}@5.0.0`;
    expect(narrow.text("Path:").plainText).toBe(path);
    expect(narrow.text("Path:").height).toBeGreaterThan(1);
    expect(narrow.frame().replace(/\s+/g, "")).toContain(path.replace(/\s+/g, ""));
    expect(narrow.text(`${longName}@5.0.0`).width).toBeGreaterThan(0);
    expect(narrow.text(`${longName}@5.0.0`).width).toBeLessThanOrEqual(20);
    expect(narrow.frame()).not.toContain("�");
    expect(narrow.state.detailCursorAction()).toBeNull();
  } finally {
    await narrow.dispose();
  }
});

test("collapse clamps cursors, scan identity resets filter/expansion to Scan, and cleanup respects nav ownership", async () => {
  const d = await renderDependencies();
  try {
    await d.click("parent@1.0.0");
    const parentIndex = d.index("parent@1.0.0");
    const oldLast = d.navRef.itemCount - 1;
    batch(() => {
      d.actions.setDetailCursorIndex(parentIndex);
      d.navRef.activateCurrentItem();
      d.actions.setDetailCursorIndex(oldLast);
    });
    await d.flush();
    expect(d.state.detailCursorIndex()).toBeLessThan(d.navRef.itemCount);
    expect(d.navRef.itemRefs).toHaveLength(d.navRef.itemCount);
    expect(d.navRef.itemRefs.every(ref => ref?.parent)).toBe(true);
    await d.click("parent@1.0.0");
    let snapshot = d.scan();
    if (!snapshot) throw new Error("Fixture scan missing.");
    d.setScan({ ...snapshot });
    await d.flush();
    expect(d.frame()).toContain("@fixture/shared@4.0.0");
    expect(d.state.detailCursorIndex()).toBe(d.index("parent@1.0.0"));
    for (const change of [{ scannedAt: "2026-10-19T13:00:00Z" }, { sha: "b".repeat(40) }]) {
      snapshot = { ...snapshot, ...change };
      d.setScan(snapshot);
      await d.flush();
      expect(d.state.detailCursorIndex()).toBe(0);
      expect(d.navRef.itemCount).toBe(6);
      expect(d.frame()).not.toContain("@fixture/shared@4.0.0");
      await d.click("parent@1.0.0");
    }
    await d.click("filter");
    await d.type("leaf");
    d.setScan({ ...snapshot });
    await d.flush();
    expect(d.input()?.value).toBe("leaf");
    expect(d.state.detailCursorIndex()).toBe(1);
    d.setScan({ ...snapshot, scannedAt: "2026-10-19T14:00:00Z" });
    await d.flush();
    expect(d.input()?.focused).toBe(false);
    expect(d.frame()).toContain("Enter dependency filter...");
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.state.detailCursorAction()).toBe("rescan");
    expect(d.navRef.itemCount).toBe(6);
    expect(d.frame()).not.toContain("@fixture/shared@4.0.0");
    const oldActivate = d.navRef.activateCurrentItem;
    d.setMounted(false);
    await d.flush();
    expect(d.navRef.itemCount).toBe(0);
    expect(d.navRef.itemRefs).toHaveLength(0);
    expect(d.navRef.handleFilterKey).toBeUndefined();
    expect(d.state.detailCursorAction()).toBeNull();
    d.actions.setDetailCursorIndex(0);
    expect(oldActivate()).toBe(false);
    expect(d.onScan).not.toHaveBeenCalled();
    d.setMounted(true);
    await d.flush();
    const newerActivate = () => true;
    const newerFilterKey = () => true;
    const newerRefs = [d.navRef.itemRefs[0]];
    d.navRef.activateCurrentItem = newerActivate;
    d.navRef.handleFilterKey = newerFilterKey;
    d.navRef.itemRefs = newerRefs;
    d.navRef.itemCount = 1;
    d.actions.setDetailCursorAction("new owner");
    d.setMounted(false);
    await d.flush();
    expect(d.navRef.activateCurrentItem).toBe(newerActivate);
    expect(d.navRef.handleFilterKey).toBe(newerFilterKey);
    expect(d.navRef.itemRefs).toBe(newerRefs);
    expect(d.navRef.itemCount).toBe(1);
    expect(d.state.detailCursorAction()).toBe("new owner");
  } finally {
    await d.dispose();
  }
});

test("unscanned commits and snapshots with no supported projects have clear Scan/Rescan states", async () => {
  const d = await renderDependencies(null);
  try {
    expect(d.frame()).toContain("No dependency scan for this commit");
    expect(d.navRef.itemCount).toBe(1);
    expect(d.state.detailCursorAction()).toBe("scan");
    await d.key("RETURN");
    expect(d.onScan).toHaveBeenCalledTimes(1);
    expect(d.input()).toBeUndefined();
    expect(d.frame()).not.toContain("Enter dependency filter...");
    await d.click("Scan commit");
    expect(d.input()).toBeUndefined();
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.onScan).toHaveBeenCalledTimes(2);
    const scan = scanFixture();
    scan.dependencyProjects = [];
    d.setScan(scan);
    await d.flush();
    expect(d.frame()).not.toContain("supported projects scanned");
    expect(d.frame()).not.toContain("Snapshot:");
    expect(d.frame()).toContain("No supported dependency projects found.");
    expect(d.state.detailCursorAction()).toBe("rescan");
    expect(d.navRef.itemCount).toBe(2);
    await d.click("filter");
    await d.type("missing");
    expect(d.frame()).toContain("No supported dependency projects found.");
    expect(d.frame()).not.toContain("No matching dependencies");
    d.actions.setDetailFocused(false);
    await d.flush();
    expect(d.state.detailCursorAction()).toBeNull();
  } finally {
    await d.dispose();
  }
});

test("large trees expose their dependency cap and filtering can reach matches beyond it", async () => {
  const scan = scanFixture();
  const graph = scan.dependencyProjects[0].graphs[0];
  graph.nodes = [{ ...graph.nodes[0], deps: [] }];
  graph.packages = graph.packages.slice(0, 1);
  for (let index = 0; index < 5001; index++) {
    const id = `dependency-${index}`;
    graph.packages.push({ id, name: id, version: "1.0.0" });
    graph.nodes.push({ nodeId: id, pkgId: id, deps: [], scope: "prod", referenceNodeId: null });
    graph.nodes[0].deps.push(id);
  }
  const d = await renderDependencies(scan);
  try {
    expect(d.navRef.itemCount).toBe(5003);
    expect(d.navRef.itemRefs).toHaveLength(5003);
    const frame = d.frame();
    for (let index = 0; index < 36; index++) expect(frame).toContain(`dependency-${index}@1.0.0`);
    expect(d.text("Dependency tree truncated").plainText).toContain("5,000 dependencies");
    await d.click("filter");
    await d.mockInput.pasteBracketedText("dependency-5000");
    await d.flush();
    expect(d.frame()).toContain("dependency-5000@1.0.0");
    expect(d.frame()).not.toContain("Dependency tree truncated");
    expect(d.navRef.itemCount).toBe(4);
    expect(d.navRef.itemRefs).toHaveLength(4);
    await d.type("x");
    expect(d.frame()).toContain("No matching dependencies");
    expect(d.frame()).not.toContain("coverage incomplete");
  } finally {
    await d.dispose();
  }
});
