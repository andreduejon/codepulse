import { expect, mock, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import { type CommandBarMode, type DialogId, useKeyboardNavigation } from "../../hooks/use-keyboard-navigation";
import { filterSnykFindings, SnykFilterRow, useSnykFilter } from "./filter";
import type { SnykFinding } from "./types";

test("finding filter matches package/version, title, CVE and ID without mutating input", () => {
  const finding: SnykFinding = {
    id: "SNYK-FIXTURE-42",
    dependency: "@fixture/package",
    installedVersion: "1.2.3",
    title: "Resource allocation",
    cves: ["CVE-2026-12345"],
    severity: "high",
    fixedVersion: null,
    project: "fixture",
    fixedIn: [],
    exploit: null,
    cvssScore: null,
    targetFile: "yarn.lock",
  };
  for (const query of ["PACKAGE", "@fixture/package@1.2.3", "allocation", "cve-2026-12345", "snyk-fixture-42", "  "])
    expect(filterSnykFindings([finding], query)).toEqual([finding]);
  expect(filterSnykFindings([finding], "no-match")).toEqual([]);
  expect(finding.dependency).toBe("@fixture/package");
});

test("filter input keeps its identity and geometry, with repository-path hover/focus styling", async () => {
  const theme = createThemeState();
  const [selected, setSelected] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const [query, setQuery] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const start = mock(() => {
    setEditing(true);
  });
  const filter = {
    query,
    setQuery,
    editing,
    start,
    stop: () => {
      setEditing(false);
    },
    reset: () => {
      setEditing(false);
      setQuery("");
    },
    suppressAutoEdit: () => {},
  };
  const descendants = (node: Renderable): Renderable[] =>
    node.getChildren().flatMap(child => [child, ...descendants(child)]);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={70}>
          <SnykFilterRow filter={filter} selected={selected()} mouseEnabled={enabled()} />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 70, height: 5, useMouse: true, enableMouseMovement: true },
  );
  const input = () => descendants(setup.renderer.root).find(node => node instanceof InputRenderable);
  const cell = (x: number) => {
    let column = 0;
    return setup.captureSpans().lines[0]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  try {
    await setup.flush();
    const original = input();
    if (!original) throw new Error("Filter input missing.");
    const geometry = [original.x, original.y, original.width, original.height];
    expect(original.focused).toBe(false);
    await setup.mockMouse.moveTo(12, 0);
    await setup.flush();
    expect(cell(1)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(cell(12)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(start).not.toHaveBeenCalled();
    await setup.mockMouse.click(12, 0, MouseButtons.RIGHT);
    await setup.flush();
    expect(editing()).toBe(false);
    expect(original.focused).toBe(false);
    await setup.mockMouse.moveTo(1, 3);
    await setup.flush();
    expect(cell(1)?.bg).toEqual(RGBA.fromHex(theme.theme().background));
    setSelected(true);
    await setup.flush();
    expect(cell(1)?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    await setup.mockMouse.click(12, 0, MouseButtons.LEFT);
    await setup.flush();
    expect(input()).toBe(original);
    expect(original.focused).toBe(true);
    expect([original.x, original.y, original.width, original.height]).toEqual(geometry);
    expect(cell(1)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    await setup.mockInput.typeText("stable");
    await setup.flush();
    expect(query()).toBe("stable");
    filter.stop();
    setSelected(false);
    setEnabled(false);
    await setup.flush();
    await setup.mockMouse.moveTo(12, 0);
    await setup.mockMouse.click(12, 0, MouseButtons.LEFT);
    await setup.flush();
    expect(input()).toBe(original);
    expect(original.focused).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(cell(1)?.bg).toEqual(RGBA.fromHex(theme.theme().background));
    expect(original.backgroundColor).toEqual(RGBA.fromHex(theme.theme().background));
  } finally {
    setup.renderer.clearSelection();
    await setup.flush();
    await setup.dispose();
  }
});

test("native filter typing owns app shortcuts; Escape and navigation release editing", async () => {
  const theme = createThemeState();
  const [dialog, setDialog] = createSignal<DialogId>(null);
  const [mode, setMode] = createSignal<CommandBarMode>("idle");
  const [searchFocused, setSearchFocused] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [command, setCommand] = createSignal("");
  const commands = mock((_command: string) => {});
  const nav: DetailNavRef = {
    itemCount: 3,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  let app!: ReturnType<typeof createAppState>;
  let filter!: ReturnType<typeof useSnykFilter>;
  const setup = await testRender(
    () => {
      app = createAppState();
      app.actions.setDetailFocused(true);
      app.actions.setActiveProviderView("snyk");
      app.actions.setDetailActiveTab("snyk-deps");
      useKeyboardNavigation({
        ...app,
        dialog,
        setDialog,
        layoutMode: () => "normal",
        searchFocused,
        setSearchFocused,
        searchInputValue: search,
        setSearchInputValue: setSearch,
        clearSearchDebounce: () => {},
        getDetailScrollboxRef: () => undefined,
        detailNavRef: nav,
        loadData: () => {},
        loadMoreData: () => {},
        handleFetch: () => {},
        commandBarMode: mode,
        setCommandBarMode: setMode,
        commandBarValue: command,
        setCommandBarValue: setCommand,
        onCommandExecute: commands,
        onPathExecute: () => {},
        onSearchExecute: () => {},
        onClearAncestry: () => {},
      });
      filter = useSnykFilter({
        scan: {
          sha: "a".repeat(40),
          scannedAt: "2026-10-20T00:00:00Z",
          includesDev: true,
          dependencyProjects: [],
          counts: { critical: 0, high: 0, medium: 0, low: 0 },
          findings: [],
        },
        onScan: () => {},
        navRef: nav,
        detailCursorIndex: app.state.detailCursorIndex,
        detailFocused: app.state.detailFocused,
        setDetailCursorAction: app.actions.setDetailCursorAction,
        setDetailCursorIndex: app.actions.setDetailCursorIndex,
      });
      nav.activateCurrentItem = () => {
        filter.start();
        return false;
      };
      return (
        <ThemeContext.Provider value={theme}>
          <box width={70}>
            <SnykFilterRow
              filter={filter}
              selected={app.state.detailCursorIndex() === 1}
              mouseEnabled={dialog() == null}
            />
          </box>
        </ThemeContext.Provider>
      );
    },
    { width: 70, height: 8, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    app.actions.setDetailCursorIndex(1);
    await setup.flush();
    expect(filter.editing()).toBe(true);
    await setup.mockInput.typeText("qmfjk:/");
    await setup.flush();
    expect(filter.query()).toBe("qmfjk:/");
    expect(commands).not.toHaveBeenCalled();
    expect(mode()).toBe("idle");
    expect(app.state.detailCursorIndex()).toBe(1);

    setDialog("help");
    await setup.flush();
    await setup.mockInput.typeText("x");
    await setup.flush();
    expect(filter.query()).toBe("qmfjk:/");
    setDialog(null);
    await setup.flush();
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(filter.editing()).toBe(false);
    expect(filter.query()).toBe("qmfjk:/");
    expect(app.state.detailFocused()).toBe(true);
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(filter.query()).toBe("");

    filter.start();
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(filter.editing()).toBe(false);
    expect(app.state.detailCursorIndex()).toBe(2);
  } finally {
    if (nav.scrollTimer) clearTimeout(nav.scrollTimer);
    await setup.dispose();
  }
  expect(nav.handleFilterKey).toBeUndefined();
});

test("vulnerability filter matches fix kind, manifest and via dependency", () => {
  const finding = {
    id: "SNYK-1",
    title: "Bypass",
    severity: "high" as const,
    dependency: "core",
    installedVersion: "1.0.0",
    fixedVersion: "1.0.1",
    project: "app",
    fixedIn: [],
    exploit: null,
    cvssScore: null,
    targetFile: "worker/pom.xml",
    dependencyType: "transitive" as const,
    dependencyPath: ["starter-web@3.4.1", "core@1.0.0"],
  };
  for (const query of ["override", "worker/pom", "starter-web"])
    expect(filterSnykFindings([finding], query)).toHaveLength(1);
  expect(filterSnykFindings([finding], "upgrade")).toHaveLength(0);
});

test("name@version queries match the finding's own package exactly; plain names stay substrings", () => {
  const base = {
    title: "Bypass",
    severity: "high" as const,
    fixedVersion: null,
    fixedIn: [],
    exploit: null,
    cvssScore: null,
    project: "app",
    targetFile: "package.json",
  };
  const own = { ...base, id: "OWN", dependency: "x", installedVersion: "1.0.2", dependencyType: "direct" as const };
  const longer = { ...base, id: "LONGER", dependency: "x", installedVersion: "1.0.21" };
  const through = {
    ...base,
    id: "THROUGH",
    dependency: "y",
    installedVersion: "2.0.0",
    dependencyType: "transitive" as const,
    dependencyPath: ["x@1.0.2", "y@2.0.0"],
  };
  const findings = [own, longer, through];
  expect(filterSnykFindings(findings, " X@1.0.2 ").map(finding => finding.id)).toEqual(["OWN"]);
  expect(filterSnykFindings(findings, "x@1.0").map(finding => finding.id)).toEqual([]);
  expect(filterSnykFindings(findings, "x").map(finding => finding.id)).toEqual(["OWN", "LONGER", "THROUGH"]);
});
