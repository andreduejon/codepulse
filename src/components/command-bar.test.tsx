import { expect, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { KnownRepoInfo } from "../config";
import { AppStateContext, createAppState } from "../context/state";
import { createThemeState, ThemeContext, themes } from "../context/theme";
import { buildGraph } from "../git/graph";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { commandBarPlaceholder } from "../utils/command-bar-utils";
import CommandBar from "./command-bar";

test("provider badges switch directly; panel width switches between two and three spaced rows", async () => {
  let app!: ReturnType<typeof createAppState>;
  const [mouseEnabled, setMouseEnabled] = createSignal(true);
  const [panelWidth, setPanelWidth] = createSignal<number | "100%">("100%");
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setCurrentBranch("develop");
      for (const id of ["github-actions", "jenkins", "openshift", "snyk"] as const) {
        app.state.providers.register({ id, displayName: id, isAvailable: () => false });
      }
      return (
        <ThemeContext.Provider value={createThemeState()}>
          <AppStateContext.Provider value={app}>
            <box width={panelWidth()} height="100%" flexDirection="column">
              <CommandBar
                commandBarMode={() => "idle"}
                commandBarValue={() => ""}
                searchInputValue={() => ""}
                searchFocused={() => false}
                detailFocused={() => false}
                onInput={() => {}}
                mouseEnabled={mouseEnabled}
                knownRepos={[]}
                currentRepo="/repo/codepulse"
              />
              <text>after bar</text>
            </box>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 90, height: 30, useMouse: true, enableMouseMovement: true },
  );
  const lines = () => setup.captureCharFrame().split("\n");
  const lineWith = (text: string) => lines().findIndex(line => line.includes(text));
  const providerSpan = () =>
    setup.captureSpans().lines[lineWith("GitHub Actions")]?.spans.find(span => span.text.includes("GitHub Actions"));
  try {
    await setup.flush();
    const providersLine = lineWith("GitHub Actions");
    expect(providersLine).toBeGreaterThan(0);
    expect(lineWith("normal")).toBe(providersLine + 2);
    expect(lineWith("codepulse")).toBe(providersLine + 4);
    expect(lineWith("develop")).toBe(providersLine + 4);
    expect(lineWith("0 commits")).toBe(providersLine + 4);
    expect(lines()[providersLine + 1].slice(1).trim()).toBe("");
    expect(lines()[providersLine + 3].slice(1).trim()).toBe("");
    expect(lineWith("after bar")).toBe(7);
    expect(lines()[providersLine]).not.toContain("·");
    expect(lines()[providersLine + 4]).not.toContain("·");
    const muted = providerSpan();
    const x = lines()[providersLine].indexOf("GitHub Actions") + 2;
    await setup.mockMouse.moveTo(x, providersLine);
    await setup.flush();
    expect(providerSpan()?.fg).not.toEqual(muted?.fg);
    expect(providerSpan()?.fg).toEqual(RGBA.fromHex(themes["catppuccin-mocha"].foreground));
    expect(providerSpan()?.bg).toEqual(muted?.bg);
    expect(app.state.activeProviderView()).toBe("git");
    await setup.mockMouse.click(x, providersLine, MouseButtons.RIGHT);
    expect(app.state.activeProviderView()).toBe("git");
    await setup.mockMouse.click(x, providersLine);
    expect(app.state.activeProviderView()).toBe("github-actions");
    await setup.flush();
    expect(providerSpan()?.fg).toEqual(RGBA.fromHex(themes["catppuccin-mocha"].githubActionsBg));
    expect(providerSpan()?.bg).toEqual(RGBA.fromHex(themes["catppuccin-mocha"].backgroundElementActive));
    setMouseEnabled(false);
    await setup.mockMouse.click(lines()[providersLine].indexOf("Jenkins") + 2, providersLine);
    expect(app.state.activeProviderView()).toBe("github-actions");
    setup.resize(180, 30);
    await setup.flush();
    expect(lineWith("codepulse")).toBe(lineWith("GitHub Actions") + 2);
    expect(lineWith("normal")).toBe(lineWith("GitHub Actions"));
    expect(lineWith("develop")).toBe(lineWith("GitHub Actions") + 2);
    expect(lineWith("after bar")).toBe(5);
    setMouseEnabled(true);
    await setup.mockMouse.click(lines()[lineWith("GitHub Actions")].indexOf("Jenkins") + 2, lineWith("GitHub Actions"));
    expect(app.state.activeProviderView()).toBe("jenkins");
    setMouseEnabled(false);
    expect(lines()[lineWith("GitHub Actions")]).not.toContain(" · ");
    app.state.providers.unregister("jenkins");
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Jenkins");
    setPanelWidth(110); // Wide terminal, narrow command-bar panel still keeps the spacers.
    await setup.flush();
    expect(lineWith("develop")).toBe(lineWith("GitHub Actions") + 4);
    setPanelWidth("100%");
    await setup.flush();
    expect(lineWith("normal")).toBe(lineWith("GitHub Actions"));
    expect(lineWith("develop")).toBe(lineWith("GitHub Actions") + 2);
    setup.resize(90, 30);
    await setup.flush();
    expect(lineWith("develop")).toBe(lineWith("GitHub Actions") + 4);
  } finally {
    setup.renderer.destroy();
  }
});

test("mode badges reflect applied filters, hover in theme colors and only delegate enabled left clicks", async () => {
  let app!: ReturnType<typeof createAppState>;
  const theme = createThemeState();
  const [mouseEnabled, setMouseEnabled] = createSignal(true);
  const selected: string[] = [];
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setCurrentBranch("develop");
      app.actions.setGraphRows(
        buildGraph(
          Array.from({ length: 201 }, (_, i) => ({
            hash: `${i}`,
            shortHash: `${i}`,
            parents: [],
            subject: `Commit ${i}`,
            body: "",
            author: "Author",
            authorEmail: "author@example.com",
            authorDate: "2026-01-01T00:00:00Z",
            committer: "Author",
            committerEmail: "author@example.com",
            commitDate: "2026-01-01T00:00:00Z",
            refs: [],
          })),
        ),
      );
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <CommandBar
              commandBarMode={() => "idle"}
              commandBarValue={() => "draft path"}
              searchInputValue={() => "draft search"}
              searchFocused={() => true}
              detailFocused={() => false}
              onInput={() => {}}
              onSelectMode={mode => selected.push(mode)}
              mouseEnabled={mouseEnabled}
              knownRepos={[]}
              currentRepo="/repo/codepulse"
            />
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 140, height: 12, useMouse: true, enableMouseMovement: true },
  );
  const lines = () => setup.captureCharFrame().split("\n");
  const row = () => lines().findIndex(line => line.includes("normal"));
  const branchRow = () => lines().findIndex(line => line.includes("develop"));
  const span = (label: string) => setup.captureSpans().lines[row()]?.spans.find(s => s.text.includes(label));
  const active = (label: string) => {
    expect(span(label)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
  };
  const muted = (label: string) => {
    expect(span(label)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
  };
  try {
    await setup.flush();
    expect(branchRow()).toBe(row() + 2);
    expect(lines()[branchRow()]).toContain("201 commits");
    expect(lines()[branchRow()].trimEnd().endsWith("201 commits")).toBe(true);
    expect(lines()[branchRow()].trimEnd().length).toBe(137); // Right edge respects the two-column padding.
    active("normal");
    for (const label of ["search", "path", "ancestry"]) muted(label);

    const x = lines()[row()].indexOf("search") + 2;
    await setup.mockMouse.moveTo(x, row());
    await setup.flush();
    expect(span("search")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    expect(span("search")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    active("normal");
    expect(app.state.highlightMode()).toBeNull();
    await setup.mockMouse.click(x, row(), MouseButtons.RIGHT);
    expect(selected).toEqual([]);
    await setup.mockMouse.click(x, row());
    expect(selected).toEqual(["search"]);
    expect(app.state.highlightMode()).toBeNull();
    setMouseEnabled(false);
    await setup.flush();
    muted("search");
    await setup.mockMouse.click(x, row());
    expect(selected).toEqual(["search"]);
    setMouseEnabled(true);
    for (const [label, mode] of [
      ["normal", "normal"],
      ["path", "path"],
      ["ancestry", "ancestry"],
    ]) {
      await setup.mockMouse.click(lines()[row()].indexOf(label) + 2, row());
      expect(selected.at(-1)).toBe(mode);
      expect(app.state.highlightMode()).toBeNull();
    }
    await setup.mockMouse.moveTo(0, 0);
    app.actions.setSearchQuery("1234567890");
    await setup.flush();
    expect(lines()[row()]).toContain(" search · 1234567890 ");
    active("search");
    muted("normal");
    app.actions.setSearchQuery("12345678901");
    app.actions.setPathFilter("1234567890");
    await setup.flush();
    expect(lines()[row()]).toContain(" path · 1234567890 ");
    app.actions.setPathFilter("src/components/command-bar.tsx");
    app.actions.setPathMatchSet(new Set(["0", "1"]));
    await setup.flush();
    expect(lines()[row()]).toContain(" search · 123456789… ");
    expect(lines()[row()]).toContain(" path · src/compo… ");
    expect(lines()[branchRow()]).toContain("2 / 201 commits");
    active("path");
    muted("search");
    app.actions.setAncestrySet(new Set(["0"]));
    app.actions.setViewingBranch("feature");
    await setup.flush();
    active("ancestry");
    muted("path");
    expect(lines()[branchRow()]).toContain("feature");
    expect(lines()[branchRow()]).toContain("develop");
    expect(lines()[branchRow()]).toContain("1 / 201 commits");
    theme.setTheme("nord");
    await setup.flush();
    active("ancestry");
    muted("normal");
  } finally {
    setup.renderer.destroy();
  }
});

test("hidden project counts slide one project per left click, preserve focus, and reset with repo or members", async () => {
  const app = createAppState(100, 0, 0);
  const theme = createThemeState();
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  const repos = names.map(name => ({ path: `/repo/${name}`, group: "app" }));
  const [knownRepos, setKnownRepos] = createSignal<KnownRepoInfo[]>(repos);
  const [currentRepo, setCurrentRepo] = createSignal("/repo/d");
  const [mouseEnabled, setMouseEnabled] = createSignal(true);
  const selected: string[] = [];
  app.actions.setDetailFocused(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <AppStateContext.Provider value={app}>
          <CommandBar
            commandBarMode={() => "search"}
            commandBarValue={() => ""}
            searchInputValue={() => "draft"}
            searchFocused={() => true}
            detailFocused={app.state.detailFocused}
            onInput={() => {}}
            mouseEnabled={mouseEnabled}
            knownRepos={knownRepos()}
            currentRepo={currentRepo()}
            onSelectProject={path => {
              selected.push(path);
              setCurrentRepo(path);
            }}
          />
        </AppStateContext.Provider>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 14, useMouse: true, enableMouseMovement: true },
  );
  const descendants = (node: Renderable): Renderable[] =>
    node.getChildren().flatMap(child => [child, ...descendants(child)]);
  const input = () => descendants(setup.renderer.root).find(node => node instanceof InputRenderable);
  const lines = () => setup.captureCharFrame().split("\n");
  const row = () => lines().findIndex(line => line.includes("0 commits"));
  const span = (label: string) => setup.captureSpans().lines[row()]?.spans.find(s => s.text.includes(label));
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const x = lines()[row()].indexOf(label);
    expect(x).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(x + 1, row(), button);
    await setup.flush();
  };
  const windowAt = (start: number, members = names) => {
    const line = lines()[row()];
    for (const [idx, name] of members.entries()) {
      expect(line.includes(` ${name} `)).toBe(idx >= start && idx < start + 3);
    }
    expect(line.includes("◂")).toBe(start > 0);
    if (start > 0) expect(line).toContain(`◂${start}`);
    const right = Math.max(0, members.length - start - 3);
    expect(line.includes("▸")).toBe(right > 0);
    if (right > 0) expect(line).toContain(`${right}▸`);
  };
  try {
    await setup.flush();
    const focusedInput = input();
    expect(focusedInput?.focused).toBe(true);
    for (const width of [100, 180]) {
      setup.resize(width, 14);
      await setup.flush();
      const providerRow = lines().findIndex(line => line.includes("Git"));
      expect(row()).toBe(providerRow + (width === 100 ? 4 : 2));
      windowAt(2);
      for (const label of ["◂2", "2▸"]) {
        expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
        expect(span(label)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
        await setup.mockMouse.moveTo(lines()[row()].indexOf(label) + 1, row());
        await setup.flush();
        expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
        expect(span(label)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
        await click(label, MouseButtons.RIGHT);
        windowAt(2);
        setMouseEnabled(false);
        await setup.flush();
        expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
        await setup.mockMouse.moveTo(0, 0);
        await setup.mockMouse.moveTo(lines()[row()].indexOf(label) + 1, row());
        await setup.flush();
        expect(span(label)?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
        await click(label);
        windowAt(2);
        setMouseEnabled(true);
        await setup.mockMouse.moveTo(0, 0);
        await setup.flush();
      }
      await click("◂2");
      windowAt(1);
      await click("◂1");
      windowAt(0);
      for (let start = 1; start <= 4; start++) {
        await click(`${5 - start}▸`);
        windowAt(start);
        expect(currentRepo()).toBe("/repo/d");
        expect(selected).toEqual([]);
        expect(app.state.activeProviderView()).toBe("git");
        expect(app.state.detailFocused()).toBe(true);
        expect(input()).toBe(focusedInput);
        expect(input()?.focused).toBe(true);
        expect(setup.renderer.getSelection()).toBeNull();
      }
      await click("◂4");
      windowAt(3);
      await click("◂3");
      windowAt(2);
    }
    await click("◂2");
    windowAt(1);
    await click(" d ");
    expect(selected).toEqual([]); // Current repo remains a no-op after sliding.
    await click(" b ");
    expect(selected).toEqual(["/repo/b"]);
    windowAt(0);
    setCurrentRepo("/repo/f");
    await setup.flush();
    windowAt(4);
    await click("◂4");
    windowAt(3);
    await click("◂3");
    windowAt(2);
    setKnownRepos(repos.slice(1));
    await setup.flush();
    windowAt(3, names.slice(1)); // Membership resets the shifted window to f.
    await click("◂3");
    windowAt(2, names.slice(1));
    setKnownRepos(repos.slice(4));
    await setup.flush();
    windowAt(0, names.slice(4));
    setKnownRepos([{ path: "/repo/f" }]);
    await setup.flush();
    windowAt(0, ["f"]);
    expect(selected).toEqual(["/repo/b"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("all non-idle modes add a focused inline input above the spaced rows; group window retains hidden counts", async () => {
  const app = createAppState(100, 0, 0);
  const [mode, setMode] = createSignal<CommandBarMode>("idle");
  const [value, setValue] = createSignal("src/current");
  const [searchValue, setSearchValue] = createSignal("draft");
  const [currentRepo, setCurrentRepo] = createSignal("/repo/charlie");
  const [mouseEnabled, setMouseEnabled] = createSignal(true);
  const selectedProjects: string[] = [];
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <AppStateContext.Provider value={app}>
          <box flexDirection="column">
            <CommandBar
              commandBarMode={mode}
              commandBarValue={value}
              searchInputValue={searchValue}
              searchFocused={() => false}
              detailFocused={() => false}
              onInput={input => (mode() === "search" ? setSearchValue(input) : setValue(input))}
              knownRepos={["alpha", "bravo", "charlie", "delta", "echo"].map(name => ({
                path: `/repo/${name}`,
                group: "app",
              }))}
              currentRepo={currentRepo()}
              mouseEnabled={mouseEnabled}
              onSelectProject={path => {
                selectedProjects.push(path);
                setCurrentRepo(path);
              }}
            />
            <text>after bar</text>
          </box>
        </AppStateContext.Provider>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 12, useMouse: true, enableMouseMovement: true },
  );
  const descendants = (node: Renderable): Renderable[] =>
    node.getChildren().flatMap(child => [child, ...descendants(child)]);
  const inputs = () => descendants(setup.renderer.root).filter(node => node instanceof InputRenderable);
  const lines = () => setup.captureCharFrame().split("\n");
  const lineWith = (text: string) => lines().findIndex(line => line.includes(text));
  try {
    for (const nextMode of ["idle", "search", "path"] as const) {
      setMode(nextMode);
      await setup.flush();
      const idle = nextMode === "idle";
      expect(inputs()).toHaveLength(idle ? 0 : 1);
      expect(lineWith("after bar")).toBe(idle ? 7 : 9);
      expect(lineWith("Git")).toBe(idle ? 1 : 3);
      expect(lineWith("bravo")).toBe(idle ? 5 : 7);
      expect(lineWith("normal")).toBe(idle ? 3 : 5);
      expect(lineWith("bravo")).toBe(lineWith("Git") + 4);
      expect(lines()[lineWith("bravo")]).toContain("◂1");
      expect(lines()[lineWith("bravo")]).toContain("charlie");
      expect(lines()[lineWith("bravo")]).toContain("delta");
      expect(lines()[lineWith("bravo")]).toContain("1▸");
      expect(setup.captureCharFrame()).not.toContain("alpha");
      expect(setup.captureCharFrame()).not.toContain("echo");
      if (!idle) {
        expect(inputs()[0]?.focused).toBe(true);
        expect(inputs()[0]?.value).toBe(nextMode === "search" ? "draft" : "src/current");
        expect(lines()[1]).toContain(nextMode === "search" ? "draft" : "src/current");
        expect(lines()[1]).not.toContain("/draft");
        if (nextMode === "path") expect(lines()[1]).not.toContain("path ");
        const modeSpans = setup.captureSpans().lines[lineWith("normal")]?.spans;
        expect(modeSpans?.find(span => span.text.includes(nextMode))?.fg).toEqual(
          RGBA.fromHex(createThemeState().theme().accent),
        );
        expect(modeSpans?.find(span => span.text.includes("normal"))?.fg).toEqual(
          RGBA.fromHex(createThemeState().theme().foregroundMuted),
        );
        (nextMode === "search" ? setSearchValue : setValue)("");
        await setup.flush();
        expect(lines()[1]).toContain(commandBarPlaceholder(nextMode));
        await setup.mockInput.typeText(`${nextMode} edit`);
        await setup.flush();
        expect((nextMode === "search" ? searchValue : value)()).toBe(`${nextMode} edit`);
        expect((nextMode === "search" ? value : searchValue)()).toBe(
          nextMode === "search" ? "src/current" : "search edit",
        );
        expect(mode()).toBe(nextMode);
        expect(app.state.searchQuery()).toBe("");
        expect(app.state.pathFilter()).toBeNull();
        expect(app.state.highlightMode()).toBeNull();
      }
    }
    await setup.mockMouse.click(lines()[lineWith("normal")].indexOf("normal") + 2, lineWith("normal"));
    expect(mode()).toBe("path"); // An omitted callback is harmless and does not apply behavior.
    setValue("");
    setMode("command");
    await setup.flush();
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0]?.focused).toBe(true);
    expect(lineWith("Enter command...")).toBe(1);
    expect(lines()[1]).toContain(":");
    expect(lineWith("Git")).toBe(3);
    expect(lineWith("normal")).toBe(5);
    expect(lineWith("after bar")).toBe(9);
    await setup.mockInput.typeText("ancestry");
    await setup.flush();
    expect(value()).toBe("ancestry");
    expect(mode()).toBe("command");
    expect(app.state.ancestrySet()).toBeNull();
    expect(lines()[1]).toContain(":ancestry");
    setValue("help");
    await setup.flush();
    expect(lines()[1]).toContain(":help");
    setMode("idle");
    setCurrentRepo("/repo/echo");
    await setup.flush();
    expect(inputs()).toHaveLength(0);
    expect(lineWith("after bar")).toBe(7);
    expect(lines()[lineWith("echo")]).toContain("◂2");
    expect(lines()[lineWith("echo")]).not.toContain("▸");
    const projectColor = (name: string) =>
      setup.captureSpans().lines[lineWith(name)]?.spans.find(span => span.text.includes(name))?.bg;
    const palette = createThemeState().theme();
    expect(projectColor("delta")).toEqual(RGBA.fromHex(palette.backgroundElementActive));
    await setup.mockMouse.moveTo(lines()[lineWith("delta")].indexOf("delta") + 2, lineWith("delta"));
    await setup.flush();
    expect(projectColor("delta")).toEqual(RGBA.fromHex(palette.backgroundElementActive));
    expect(setup.captureSpans().lines[lineWith("delta")]?.spans.find(span => span.text.includes("delta"))?.fg).toEqual(
      RGBA.fromHex(palette.foreground),
    );
    expect(currentRepo()).toBe("/repo/echo");
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    expect(projectColor("delta")).toEqual(RGBA.fromHex(palette.backgroundElementActive));
    const clickProject = async (
      name: string,
      button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
    ) => {
      const row = lineWith(name);
      await setup.mockMouse.click(lines()[row].indexOf(name) + 2, row, button);
      await setup.flush();
    };
    await clickProject("echo");
    expect(selectedProjects).toEqual([]); // Current project is a no-op.
    await clickProject("delta", MouseButtons.RIGHT);
    expect(selectedProjects).toEqual([]);
    setMouseEnabled(false);
    await clickProject("delta");
    expect(selectedProjects).toEqual([]); // Dialog guard blocks project switches.
    expect(projectColor("delta")).toEqual(RGBA.fromHex(palette.backgroundElementActive));
    setMouseEnabled(true);
    await clickProject("delta");
    expect(selectedProjects).toEqual(["/repo/delta"]);
    expect(currentRepo()).toBe("/repo/delta");
    const projectSpan = setup.captureSpans().lines[lineWith("delta")]?.spans.find(span => span.text.includes("delta"));
    expect(projectSpan?.bg).toEqual(RGBA.fromHex(createThemeState().theme().accent));
    setup.resize(180, 12);
    await setup.flush();
    await clickProject("charlie");
    expect(selectedProjects).toEqual(["/repo/delta", "/repo/charlie"]);
    expect(lines()[lineWith("charlie")]).toContain("◂1");
    expect(lines()[lineWith("charlie")]).toContain("1▸");
  } finally {
    setup.renderer.destroy();
  }
});
