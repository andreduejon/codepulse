import { expect, mock, spyOn, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA, TextAttributes, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender, useKeyboard } from "@opentui/solid";
import { batch, createSignal, Show } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { handleDetailKey } from "../../hooks/handle-detail-keys";
import * as clipboard from "../../hooks/use-clipboard";
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
  // Leaf rows copy on Enter; never spawn the real clipboard tool in tests.
  const copy = mock((_text: string, _id: string) => {});
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  const [scan, setScan] = createSignal(initial);
  const [loading, setLoading] = createSignal(false);
  const [modal, setModal] = createSignal(false);
  const [mounted, setMounted] = createSignal(true);
  const onScan = mock(() => {});
  const onShowVulnerabilities = mock((_query: string) => {});
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
                setDetailCursorShortcut={app.actions.setDetailCursorShortcut}
                onShowVulnerabilities={onShowVulnerabilities}
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
      const row = navRef.itemRefs[4];
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
    try {
      await setup.dispose();
    } finally {
      clipboardSpy.mockRestore();
    }
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
    onShowVulnerabilities,
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
    copy,
  };
}

test("dependency browser has an inline filter, folded file root, right-aligned dev flags and central navigation", async () => {
  const d = await renderDependencies();
  try {
    const lines = d.frame().split("\n");
    const scanLine = lines.findIndex(line => line.includes("Rescan commit"));
    expect(lines[scanLine + 1]).toMatch(/^Copy dependencies as JSON\s*$/);
    expect(lines[scanLine + 2].trim()).toBe("");
    expect(lines[scanLine + 3]).toMatch(/^Group by\s+\[tree\]\s*$/);
    expect(lines[scanLine + 4]).toMatch(/^Scope\s+\[all\]\s*$/);
    expect(lines[scanLine + 5]).toContain("Enter dependency filter...");
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
    expect(d.navRef.itemCount).toBe(9);
    expect(d.navRef.itemRefs).toHaveLength(9);
    expect(d.navRef.itemRefs.every(ref => ref?.getChildren().length > 0)).toBe(true);
    expect(d.index("filter")).toBe(4);
    expect(d.index("web/bun.lock")).toBe(5);
    expect(d.index("parent@1.0.0")).toBe(6);
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorAction()).toBe("rescan");
    for (const [index, action] of [
      [1, "copy"],
      [2, "switch"],
      [3, "switch"],
    ] as const) {
      await d.key("ARROW_DOWN");
      expect(d.state.detailCursorIndex()).toBe(index);
      expect(d.state.detailCursorAction()).toBe(action);
    }
    await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(4);
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
    expect(d.state.detailCursorIndex()).toBe(5);
    expect(d.state.detailCursorAction()).toBe("collapse");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(6);
    expect(d.frame()).not.toContain("parent@1.0.0");
    expect(d.frame()).not.toContain("\nscanned");
    expect(d.state.detailCursorAction()).toBe("expand");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(9);
    await d.key("ARROW_UP");
    expect(d.state.detailCursorIndex()).toBe(4);
    expect(d.input()?.focused).toBe(true);
    await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(5);
    await d.key("ARROW_DOWN");
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(11);
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(9);
    const leafIndex = d.index("mystery@3.0.0");
    d.actions.setDetailCursorIndex(leafIndex);
    await d.flush();
    // Leaves copy their full name@version instead of toggling.
    expect(d.state.detailCursorAction()).toBe("copy");
    await d.key("RETURN");
    expect(d.copy).toHaveBeenLastCalledWith("mystery@3.0.0", expect.any(String));
    expect(d.navRef.itemCount).toBe(9);
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
    expect(d.navRef.itemCount).toBe(9);
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
    expect(sidebar.navRef.itemCount).toBe(9);
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
    expect(d.frame()).not.toContain("No supported dependency project.");
    expect(d.frame()).not.toContain("No dependencies");
    await d.click("filter");
    await d.type("leaf");
    const input = d.input();
    expect(input?.focused).toBe(true);
    expect(input?.value).toBe("leaf");
    expect(input?.cursorOffset).toBe(4);
    expect(d.state.detailCursorIndex()).toBe(4);
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
    // No "no match" message: headers stay listed with zero counts; failed coverage stays visible.
    expect(d.frame()).not.toContain("No matching dependencies");
    expect(d.frame()).toMatch(/0\/\d+/);
    expect(d.frame()).toContain("failed · Graph extraction incomplete");
    expect(d.frame()).toContain("skipped · Unsupported lockfile format");
    await d.key("ESCAPE");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorIndex()).toBe(4);
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
    expect(d.state.detailCursorIndex()).toBe(4);
    expect(d.state.detailActiveTab()).toBe(tab);
    expect(d.onScan).not.toHaveBeenCalled();
    await d.key("ESCAPE");
    await d.key("ESCAPE");
    await d.click("filter");
    await d.type("leaf");
    await d.click("web/bun.lock");
    expect(d.input()?.focused).toBe(false);
    expect(d.state.detailCursorIndex()).toBe(5);
    expect(d.state.detailCursorAction()).toBe("expand");
  } finally {
    await d.dispose();
  }
});

test("references expand canonical children with their own dev flag, cycles stop, and selected paths wrap", async () => {
  const d = await renderDependencies();
  // Repeated/circular rows carry a muted, right-aligned word instead of an arrow marker.
  const marked = (label: string, marker: string) => {
    const row = d.navRef.itemRefs.find(
      ref =>
        ref?.getChildren().some(node => node instanceof TextRenderable && node.plainText === label) &&
        ref.getChildren().some(node => node instanceof TextRenderable && node.plainText === ` ${marker}`),
    );
    if (!row) throw new Error(`Missing ${marker} row: ${label}`);
    return row;
  };
  try {
    await d.click("parent@1.0.0");
    expect(d.frame()).not.toContain("↩");
    expect(d.frame()).toMatch(/parent@1\.0\.0\s+circular\s*$/m);
    const circular = marked("parent@1.0.0", "circular");
    const word = circular.getChildren().find(node => node instanceof TextRenderable && node.plainText === " circular");
    expect((word?.x ?? 0) + (word?.width ?? 0)).toBe(110);
    const wordSpan = d.captureSpans().lines[circular.screenY]?.spans.find(span => span.text.trim() === "circular");
    expect(wordSpan?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    await d.click("dev-only@2.0.0");
    expect(d.frame()).not.toContain("↪");
    const reference = marked("@fixture/shared@4.0.0", "repeated");
    expect(reference.getChildren().some(node => node instanceof TextRenderable && node.plainText === " dev")).toBe(
      true,
    );
    expect(d.frame()).toMatch(/@fixture\/shared@4\.0\.0\s+repeated dev\s*$/m);
    d.actions.setDetailCursorIndex(d.navRef.itemRefs.indexOf(reference));
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("expand");
    const beforeReference = d.navRef.itemCount;
    await d.key("RETURN");
    expect(d.navRef.itemCount).toBe(beforeReference + 1);
    expect(d.frame()).toContain("leaf@5.0.0");
    d.actions.setDetailCursorIndex(d.navRef.itemRefs.indexOf(marked("parent@1.0.0", "circular")));
    await d.flush();
    const count = d.navRef.itemCount;
    expect(d.state.detailCursorAction()).toBe("copy");
    d.navRef.activateCurrentItem();
    await d.flush();
    expect(d.navRef.itemCount).toBe(count);
    // Nesting shows the path; no extra Path line.
    expect(d.frame()).not.toContain("Path:");
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
    // A clipped name on the cursor row banner-scrolls from its start instead of a Path line.
    expect(narrow.frame()).not.toContain("Path:");
    const visible = narrow.text("@fixture/a").plainText;
    expect(`${longName}@5.0.0`.startsWith(visible)).toBe(true);
    expect(visible.length).toBeLessThan(`${longName}@5.0.0`.length);
    expect(narrow.frame()).not.toContain("�");
    expect(narrow.state.detailCursorAction()).toBe("copy");
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
      expect(d.navRef.itemCount).toBe(9);
      expect(d.frame()).not.toContain("@fixture/shared@4.0.0");
      await d.click("parent@1.0.0");
    }
    await d.click("filter");
    await d.type("leaf");
    d.setScan({ ...snapshot });
    await d.flush();
    expect(d.input()?.value).toBe("leaf");
    expect(d.state.detailCursorIndex()).toBe(4);
    d.setScan({ ...snapshot, scannedAt: "2026-10-19T14:00:00Z" });
    await d.flush();
    expect(d.input()?.focused).toBe(false);
    expect(d.frame()).toContain("Enter dependency filter...");
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.state.detailCursorAction()).toBe("rescan");
    expect(d.navRef.itemCount).toBe(9);
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
    // Like Vulnerabilities: only the Scan commit row, no placeholder text.
    expect(d.frame().trim()).toBe("Scan commit");
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
    expect(d.frame()).toContain("No supported dependency project.");
    expect(d.state.detailCursorAction()).toBe("rescan");
    // Nothing to browse: Rescan only, no Copy, Group by, Scope or filter (like Vulnerabilities without findings).
    expect(d.navRef.itemCount).toBe(1);
    for (const hidden of ["Copy dependencies as JSON", "Group by", "Scope", "Enter dependency filter..."])
      expect(d.frame()).not.toContain(hidden);
    expect(d.input()).toBeUndefined();
    for (let step = 0; step < 3; step++) await d.key("ARROW_DOWN");
    expect(d.state.detailCursorIndex()).toBe(0);
    expect(d.state.detailCursorAction()).toBe("rescan");
    expect(d.input()).toBeUndefined();
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
  for (let index = 0; index < 1001; index++) {
    const id = `dependency-${index}`;
    graph.packages.push({ id, name: id, version: "1.0.0" });
    graph.nodes.push({ nodeId: id, pkgId: id, deps: [], scope: "prod", referenceNodeId: null });
    graph.nodes[0].deps.push(id);
  }
  const d = await renderDependencies(scan);
  try {
    expect(d.navRef.itemCount).toBe(1006);
    expect(d.navRef.itemRefs).toHaveLength(1006);
    const frame = d.frame();
    for (let index = 0; index < 36; index++) expect(frame).toContain(`dependency-${index}@1.0.0`);
    expect(d.text("Dependency tree truncated").plainText).toContain("1,000 dependencies");
    await d.click("filter");
    await d.mockInput.pasteBracketedText("dependency-1000");
    await d.flush();
    expect(d.frame()).toContain("dependency-1000@1.0.0");
    expect(d.frame()).not.toContain("Dependency tree truncated");
    expect(d.navRef.itemCount).toBe(7);
    expect(d.navRef.itemRefs).toHaveLength(7);
    await d.type("x");
    expect(d.frame()).not.toContain("No matching dependencies");
    expect(d.frame()).toMatch(/0\/\d+/);
    expect(d.frame()).not.toContain("coverage incomplete");
  } finally {
    await d.dispose();
  }
});

test("headers count packages like severity headers; short Maven names, full name on the cursor and copy; closing cascades", async () => {
  const scan = scanFixture();
  const mystery = scan.dependencyProjects[0].graphs[0].packages.find(pkg => pkg.name === "mystery");
  if (mystery) mystery.name = "org.fixture:mystery";
  const d = await renderDependencies(scan);
  try {
    const row = (text: string) =>
      d
        .frame()
        .split("\n")
        .find(line => line.includes(text)) ?? "";
    // Header at column 0, bold, with the package count (root excluded); filter row shows the total.
    expect(row("web/bun.lock (converted)")).toMatch(/^▾ web\/bun\.lock \(converted\)\s{2,}fixture-app 5$/);
    // Manifest stays the bold label; the project name follows muted.
    const nameAt = d.point("fixture-app");
    let nameColumn = 0;
    const nameSpan = d.captureSpans().lines[nameAt.y]?.spans.find(item => {
      nameColumn += item.text.length;
      return nameColumn > nameAt.x;
    });
    expect(nameSpan?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    const header = d.point("web/bun.lock");
    let column = 0;
    const span = d.captureSpans().lines[header.y]?.spans.find(item => {
      column += item.text.length;
      return column > header.x;
    });
    expect(((span?.attributes ?? 0) & TextAttributes.BOLD) !== 0).toBe(true);
    expect(row("Enter dependency filter...")).toMatch(/Enter dependency filter\.\.\.\s+5\s*$/);
    // Maven coordinates: short label, full coordinates in the Path line and in the copied text.
    expect(d.frame()).toContain("mystery@3.0.0");
    expect(d.frame()).not.toContain("org.fixture");
    d.actions.setDetailCursorIndex(d.index("mystery@3.0.0"));
    await d.flush();
    // The cursor row shows full Maven coordinates (no separate Path line).
    expect(d.frame()).toContain("org.fixture:mystery@3.0.0");
    expect(d.frame()).not.toContain("Path:");
    await d.key("RETURN");
    expect(d.copy).toHaveBeenLastCalledWith("org.fixture:mystery@3.0.0", expect.any(String));
    // Closing a node closes everything below it.
    await d.click("parent@1.0.0");
    await d.click("@fixture/shared@4.0.0");
    expect(d.frame()).toContain("leaf@5.0.0");
    await d.click("parent@1.0.0");
    expect(d.frame()).not.toContain("@fixture/shared@4.0.0");
    await d.click("parent@1.0.0");
    expect(d.frame()).toContain("@fixture/shared@4.0.0");
    expect(d.frame()).not.toContain("leaf@5.0.0");
    // Filtering: N/M on header and filter row; zero keeps the header listed, muted and not a cursor stop.
    await d.click("filter");
    await d.type("leaf");
    expect(row("(converted)")).toMatch(/\(converted\)\s{2,}fixture-app 1\/5$/);
    expect(d.frame()).toMatch(/leaf\s+1\/5/);
    await d.type("zzz");
    expect(row("(converted)")).toMatch(/^· web\/bun\.lock \(converted\)\s{2,}fixture-app 0\/5$/);
    expect(d.navRef.itemCount).toBe(5);
  } finally {
    await d.dispose();
  }
});

test("unchanged rows keep their renderables across tree rebuilds", async () => {
  const d = await renderDependencies();
  try {
    const before = d.text("mystery@3.0.0");
    // Opening a sibling rebuilds the tree; the unchanged row must not be re-created.
    await d.click("dev-only@2.0.0");
    expect(d.frame()).toContain("dev-only@2.0.0");
    expect(d.text("mystery@3.0.0")).toBe(before);
  } finally {
    await d.dispose();
  }
});

test("Scope cycles all, prod and dev like Group by and keeps the cursor on its row", async () => {
  const d = await renderDependencies();
  try {
    d.actions.setDetailCursorIndex(3);
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("switch");
    expect(d.frame()).toMatch(/^Scope\s+\[all\]\s*$/m);
    await d.key("RETURN");
    expect(d.frame()).toMatch(/^Scope\s+\[prod\]\s*$/m);
    expect(d.frame()).toContain("parent@1.0.0");
    expect(d.frame()).not.toContain("dev-only@2.0.0");
    await d.key("RETURN");
    expect(d.frame()).toMatch(/^Scope\s+\[dev\]\s*$/m);
    expect(d.frame()).toContain("dev-only@2.0.0");
    expect(d.frame()).not.toContain("mystery@3.0.0");
    expect(d.state.detailCursorIndex()).toBe(3);
    await d.click("Scope");
    expect(d.frame()).toMatch(/^Scope\s+\[all\]\s*$/m);
    expect(d.frame()).toContain("mystery@3.0.0");
  } finally {
    await d.dispose();
  }
});

test("opening a row past the row cap closes other branches instead of truncating", async () => {
  const scan = scanFixture();
  const graph = scan.dependencyProjects[0].graphs[0];
  graph.packages = [graph.packages[0]];
  graph.nodes = [{ ...graph.nodes[0], deps: ["a", "b"] }];
  for (const branch of ["a", "b"]) {
    graph.packages.push({ id: branch, name: `branch-${branch}`, version: "1.0.0" });
    graph.nodes.push({ nodeId: branch, pkgId: branch, deps: [], scope: "prod", referenceNodeId: null });
    for (let index = 0; index < 600; index++) {
      const id = `${branch}-${index}`;
      graph.packages.push({ id, name: id, version: "1.0.0" });
      graph.nodes.push({ nodeId: id, pkgId: id, deps: [], scope: "prod", referenceNodeId: null });
      graph.nodes[graph.nodes.length - 1 - index - 1].deps.push(id);
    }
  }
  const d = await renderDependencies(scan);
  try {
    await d.click("branch-a@1.0.0");
    expect(d.frame()).toContain("a-0@1.0.0");
    d.actions.setDetailCursorIndex(d.index("branch-b@1.0.0"));
    d.navRef.activateCurrentItem();
    await d.flush();
    expect(
      d
        .text("branch-a@1.0.0")
        .parent?.getChildren()
        .some(node => node instanceof TextRenderable && node.plainText === "▸ "),
    ).toBe(true);
    expect(d.frame()).not.toContain("Dependency tree truncated");
    expect(d.navRef.itemCount).toBe(5 + 1 + 2 + 600);
  } finally {
    await d.dispose();
  }
});

test("Group by switches between the tree and a package list with direct markers", async () => {
  const d = await renderDependencies();
  try {
    d.actions.setDetailCursorIndex(2);
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("switch");
    await d.key("RETURN");
    expect(d.frame()).toMatch(/^Group by\s+\[package\]\s*$/m);
    expect(d.state.detailCursorIndex()).toBe(2);
    // A–Z unique packages; direct dependencies carry a muted `direct`, dev-only ones `dev`.
    expect(d.frame()).toMatch(/├─ ▸ @fixture\/shared@4\.0\.0\s*$/m);
    expect(d.frame()).toMatch(/├─ dev-only@2\.0\.0\s+direct dev$/m);
    expect(d.frame()).toMatch(/└─ parent@1\.0\.0\s+direct$/m);
    await d.click("@fixture/shared@4.0.0");
    expect(d.frame()).toMatch(/│ {2}├─ dev-only@2\.0\.0\s*$/m);
    expect(d.frame()).toMatch(/│ {2}└─ parent@1\.0\.0\s*$/m);
    await d.click("Group by");
    expect(d.frame()).toMatch(/^Group by\s+\[tree\]\s*$/m);
    expect(d.frame()).toContain("▸ parent@1.0.0");
  } finally {
    await d.dispose();
  }
});

test("Copy dependencies as JSON copies the flat package list with scope and filter", async () => {
  const d = await renderDependencies();
  try {
    await d.click("filter");
    await d.type("shared");
    d.actions.setDetailCursorIndex(1);
    await d.flush();
    expect(d.state.detailCursorAction()).toBe("copy");
    await d.key("RETURN");
    const [text, id] = d.copy.mock.calls[d.copy.mock.calls.length - 1];
    expect(id).toBe("copyJson");
    const json = JSON.parse(text);
    expect(json).toMatchObject({ commit: "a".repeat(40), scope: "all", filter: "shared", includesDev: true });
    expect(json.projects[0].packages).toEqual([
      { name: "@fixture/shared", version: "4.0.0", direct: false, dev: false, via: ["dev-only@2.0.0", "parent@1.0.0"] },
    ]);
  } finally {
    await d.dispose();
  }
});

test("vulnerable packages show a triangle in their worst severity colour; v opens their findings", async () => {
  const scan = scanFixture();
  const finding = (id: string, path: string[], severity: "critical" | "low") => {
    const [dependency, version] = (path[path.length - 1] ?? "").split(/@(?=[^@]+$)/);
    return {
      id,
      title: id,
      severity,
      dependency,
      installedVersion: version,
      fixedVersion: null,
      fixedIn: [],
      exploit: null,
      cvssScore: 5,
      dependencyType: path.length === 1 ? ("direct" as const) : ("transitive" as const),
      dependencyPath: path,
      upgradeDependency: null,
      upgradeVersion: null,
      cves: [id],
      project: "fixture-app",
      targetFile: "web/package.json",
    };
  };
  scan.findings = [
    finding("CVE-1", ["mystery@3.0.0"], "low"),
    // Worst severity wins.
    finding("CVE-2", ["mystery@3.0.0"], "critical"),
    finding("CVE-3", ["dev-only@2.0.0"], "low"),
  ];
  const d = await renderDependencies(scan);
  try {
    const line = (text: string) =>
      d
        .frame()
        .split("\n")
        .find(row => row.includes(text)) ?? "";
    const spans = (text: string) => d.captureSpans().lines[d.point(text).y]?.spans ?? [];
    // Nothing opens for findings; only the package itself is marked, flush right after `dev`.
    expect(d.frame()).toMatch(/▸ parent@1\.0\.0\s*$/m);
    expect(line("mystery@3.0.0")).toMatch(/mystery@3\.0\.0\s+▲$/);
    expect(line("dev-only@2.0.0")).toMatch(/dev-only@2\.0\.0\s+dev ▲$/);
    expect(spans("mystery@3.0.0").find(span => span.text.includes("▲"))?.fg).toEqual(
      RGBA.fromHex(d.theme.severityCritical),
    );
    expect(spans("dev-only@2.0.0").find(span => span.text.includes("▲"))?.fg).toEqual(
      RGBA.fromHex(d.theme.severityLow),
    );
    expect(d.frame()).not.toMatch(/\d\.\d$|!/m);
    // `v` on a vulnerable row hands its full `name@version` over; elsewhere it does nothing.
    d.actions.setDetailCursorIndex(d.index("mystery@3.0.0"));
    await d.flush();
    expect(d.state.detailCursorShortcut()).toEqual({ key: "v", desc: "vulnerabilities" });
    await d.key("v");
    expect(d.onShowVulnerabilities).toHaveBeenCalledWith("mystery@3.0.0");
    await d.click("parent@1.0.0");
    expect(d.state.detailCursorShortcut()).toBeNull();
    await d.key("v");
    expect(d.onShowVulnerabilities).toHaveBeenCalledTimes(1);
  } finally {
    await d.dispose();
  }
});

test("leaves sit one space after the connector", async () => {
  const d = await renderDependencies();
  try {
    const line = d
      .frame()
      .split("\n")
      .find(row => row.includes("mystery@3.0.0"));
    expect(line).toMatch(/^└─ mystery@3\.0\.0\s*$/);
  } finally {
    await d.dispose();
  }
});

test("filter hits are highlighted in package names, not versions", async () => {
  const d = await renderDependencies();
  try {
    await d.click("filter");
    await d.type("aren");
    const spans = d.captureSpans().lines[d.point("parent@1.0.0").y]?.spans ?? [];
    expect(spans.find(span => span.text === "aren")?.fg).toEqual(RGBA.fromHex(d.theme.snykBg));
    expect(spans.find(span => span.text.includes("@1.0.0"))?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
  } finally {
    await d.dispose();
  }
});

test("a triangle in a sibling group reserves its column on every sibling, so dev lines up", async () => {
  const scan = scanFixture();
  scan.findings = [
    {
      id: "CVE-1",
      title: "CVE-1",
      severity: "low",
      dependency: "mystery",
      installedVersion: "3.0.0",
      fixedVersion: null,
      fixedIn: [],
      exploit: null,
      cvssScore: 3,
      dependencyType: "direct",
      dependencyPath: ["mystery@3.0.0"],
      upgradeDependency: null,
      upgradeVersion: null,
      cves: ["CVE-1"],
      project: "fixture-app",
      targetFile: "web/package.json",
    },
  ];
  const d = await renderDependencies(scan);
  try {
    const line = (text: string) =>
      d
        .frame()
        .split("\n")
        .find(row => row.includes(text)) ?? "";
    expect(line("mystery@3.0.0")).toMatch(/mystery@3\.0\.0\s+▲$/);
    // dev-only has no triangle, but its sibling does: dev moves into the same column as a marked row's dev.
    expect(line("dev-only@2.0.0")).toMatch(/dev-only@2\.0\.0\s+dev {2}$/);
  } finally {
    await d.dispose();
  }
});
