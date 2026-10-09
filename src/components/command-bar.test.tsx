import { expect, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
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

test("all non-idle modes add a focused inline input above the spaced rows; group window retains hidden counts", async () => {
  const app = createAppState(100, 0, 0);
  const [mode, setMode] = createSignal<CommandBarMode>("idle");
  const [value, setValue] = createSignal("src/current");
  const [searchValue, setSearchValue] = createSignal("draft");
  const [currentRepo, setCurrentRepo] = createSignal("/repo/charlie");
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
            />
            <text>after bar</text>
          </box>
        </AppStateContext.Provider>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 12, useMouse: true },
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
  } finally {
    setup.renderer.destroy();
  }
});
