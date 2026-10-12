import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { type CustomTheme, createThemeState, ThemeContext, themeNames, themes } from "../../context/theme";
import ThemeDialog from "./theme-dialog";

const derivedTheme: CustomTheme = {
  id: "custom-nord",
  base: "nord",
  overrides: ["accent", "warning", "graphColors"],
  theme: {
    ...themes.nord,
    name: "Custom Nord",
    accent: "#123456",
    graphColors: ["#112233", ...themes.nord.graphColors.slice(1), "#fedcba"],
  },
};
const standaloneTheme: CustomTheme = {
  id: "custom-standalone",
  overrides: ["accent", "graphColors"],
  theme: { ...themes["catppuccin-mocha"], name: "Standalone" },
};

test("custom registries stay instance-local and leave predefined themes unchanged", () => {
  const originals = structuredClone(themes);
  const first = createThemeState(derivedTheme.id, [derivedTheme]);
  const alternate = { ...derivedTheme, theme: { ...derivedTheme.theme, accent: "#654321" } };
  const second = createThemeState(derivedTheme.id, [alternate, standaloneTheme]);
  const builtin = createThemeState();

  expect(first.theme()).toEqual(derivedTheme.theme);
  expect(second.theme()).toEqual(alternate.theme);
  expect(first.themes[standaloneTheme.id]).toBeUndefined();
  expect(builtin.themes[derivedTheme.id]).toBeUndefined();
  first.setTheme("nord");
  expect(first.theme()).toEqual(originals.nord);
  expect(second.themeName()).toBe(derivedTheme.id);
  expect(second.theme().accent).toBe("#654321");
  expect(themes).toEqual(originals);
  expect(themeNames).toEqual(Object.keys(originals));
});

test.each(["escape", "click"])(
  "custom sections skip headings, save custom IDs, and %s close restores the last applied custom",
  async close => {
    const theme = createThemeState("olive-garden", [derivedTheme, standaloneTheme]);
    const [open, setOpen] = createSignal(true);
    const onSelect = mock((_name: string) => {});
    const setup = await testRender(
      () => (
        <ThemeContext.Provider value={theme}>
          <Show when={open()}>
            <ThemeDialog onClose={() => setOpen(false)} onSelect={onSelect} />
          </Show>
        </ThemeContext.Provider>
      ),
      { width: 100, height: 40, useMouse: true },
    );
    const point = (label: string) => {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex(line => line.trim().startsWith(label));
      expect(y).toBeGreaterThanOrEqual(0);
      return { x: lines[y].indexOf(label) + 1, y };
    };
    const marker = (label: string, symbol: string) =>
      setup.captureSpans().lines[point(label).y]?.spans.find(span => span.text.includes(symbol));
    try {
      await setup.flush();
      expect(point("Predefined").y).toBeLessThan(point(themes[themeNames[0]].name).y);
      expect(point("Custom").y).toBe(point(themes["olive-garden"].name).y + 2);
      expect(setup.captureCharFrame().split("\n")[point("Custom").y - 1].trim()).toBe("");
      expect(point("Custom").y).toBeLessThan(point("Custom Nord").y);
      expect(setup.captureCharFrame()).not.toContain("*");
      expect(setup.captureCharFrame()).toContain("Standalone");
      expect(setup.captureCharFrame()).not.toContain("Standalone *");
      for (const builtin of Object.values(themes)) expect(setup.captureCharFrame()).toContain(builtin.name);
      for (const heading of ["Predefined", "Custom"]) {
        const { x, y } = point(heading);
        expect(setup.captureSpans().lines[y].spans.find(s => s.text.includes(heading))?.fg).toEqual(
          RGBA.fromHex(theme.theme().accent),
        );
        await setup.mockMouse.click(x, y);
        await setup.flush();
        expect(theme.themeName()).toBe("olive-garden");
        expect(onSelect).not.toHaveBeenCalled();
      }
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.flush();
      expect(theme.themeName()).toBe(derivedTheme.id);
      expect(marker("Custom Nord", "█")?.fg).toEqual(RGBA.fromHex(derivedTheme.theme.accent));
      expect(marker(themes["olive-garden"].name, "✓")).toBeDefined();
      expect(onSelect).not.toHaveBeenCalled();
      setup.mockInput.pressKey("ARROW_UP");
      await setup.flush();
      expect(theme.themeName()).toBe("olive-garden");
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.flush();
      if (close === "escape") setup.mockInput.pressEnter();
      else {
        const { x, y } = point("Custom Nord");
        await setup.mockMouse.click(x, y);
      }
      await setup.flush();
      expect(open()).toBe(true);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(derivedTheme.id);
      expect(marker("Custom Nord", "✓")?.bg).toEqual(RGBA.fromHex(derivedTheme.theme.accent));
      expect(marker("Custom Nord", "✓")?.fg).toEqual(RGBA.fromHex(derivedTheme.theme.background));
      expect(marker("Custom Nord", "█")).toBeUndefined();
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.flush();
      expect(theme.themeName()).toBe(standaloneTheme.id);
      expect(marker("Standalone", "█")?.fg).toEqual(RGBA.fromHex(standaloneTheme.theme.accent));
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.flush();
      expect(theme.themeName()).toBe(standaloneTheme.id);
      if (close === "escape") {
        setup.mockInput.pressEscape();
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        const lines = setup.captureCharFrame().split("\n");
        const y = lines.findIndex(line => line.includes("esc close"));
        expect(y).toBeGreaterThanOrEqual(0);
        await setup.mockMouse.click(lines[y].indexOf("esc close") + 1, y);
      }
      await setup.flush();
      expect(open()).toBe(false);
      expect(theme.themeName()).toBe(derivedTheme.id);
      expect(onSelect).toHaveBeenCalledTimes(1);
    } finally {
      await setup.dispose();
    }
  },
);

test("selected custom details show metadata, mark explicit overrides, and use effective scalar and graph swatches", async () => {
  const theme = createThemeState(derivedTheme.id, [derivedTheme, standaloneTheme]);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={{ ...theme, theme: () => ({ ...theme.theme(), accent: "#abcdef" }) }}>
        <ThemeDialog onClose={() => {}} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40 },
  );
  const row = (label: string) => {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.trim().startsWith(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { y, text: lines[y], spans: setup.captureSpans().lines[y].spans };
  };
  try {
    await setup.flush();
    expect(theme.themeName()).toBe(derivedTheme.id);
    expect(row("Custom Nord").spans.find(span => span.text.includes("✓"))?.bg).toEqual(
      RGBA.fromHex(derivedTheme.theme.accent),
    );
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(row("Custom Nord *").spans.find(span => span.text.includes("✓"))?.bg).toEqual(
      RGBA.fromHex(derivedTheme.theme.accent),
    );
    const metadata = () => {
      const heading = row("Custom Nord *");
      const valueEnd = heading.text.indexOf("✓") - 1;
      expect(row("id").y).toBe(heading.y + 1);
      expect(row("id").text.trim()).toMatch(/^id\s+custom-nord$/);
      expect(row("base").y).toBe(heading.y + 2);
      expect(row("base").text.trim()).toMatch(/^base\s+Nord \(nord\)$/);
      for (const [label, value] of [
        ["id", derivedTheme.id],
        ["base", `${themes.nord.name} (${derivedTheme.base})`],
      ]) {
        expect(row(label).text.indexOf(value) + value.length).toBe(valueEnd);
        expect(row(label).spans.find(span => span.text.includes(value))?.fg).toEqual(
          RGBA.fromHex(theme.theme().foregroundMuted),
        );
      }
    };
    metadata();
    expect(row("background").y).toBe(row("Custom Nord *").y + 4);
    expect(setup.captureCharFrame().split("\n")[row("base").y + 1].trim()).toBe("");
    expect(row("accent *").text).toMatch(new RegExp(`accent \\*\\s+${themes.nord.accent} → #abcdef █`));
    expect(row("accent *").spans.find(span => span.text.includes("█"))?.fg).toEqual(RGBA.fromHex("#abcdef"));
    expect(row("warning *").text).toMatch(
      new RegExp(`warning \\*\\s+${themes.nord.warning} → ${themes.nord.warning} █`),
    );
    expect(row("background").text).toMatch(new RegExp(`background\\s+${themes.nord.background} █`));
    expect(row("background").text).not.toContain("*");
    expect(row("background").text).not.toContain("→");
    expect(row("background").spans.find(span => span.text.includes("█"))?.fg).toEqual(
      RGBA.fromHex(themes.nord.background),
    );
    const captures = [setup.captureSpans()];
    let seen = setup.captureCharFrame();
    for (let page = 0; page < 4; page++) {
      setup.mockInput.pressKey("\u001b[6~");
      await setup.flush();
      captures.push(setup.captureSpans());
      seen += `\n${setup.captureCharFrame()}`;
      metadata();
    }
    derivedTheme.theme.graphColors.forEach((hex, index) => {
      const label = `graph color ${index + 1} *`;
      const baseHex = themes.nord.graphColors[index] ?? "—";
      expect(seen).toMatch(new RegExp(`graph color ${index + 1} \\*\\s+${baseHex} → ${hex} █`));
      const graphRow = captures
        .flatMap(capture => capture.lines)
        .find(line => line.spans.some(span => span.text.includes(label)));
      expect(graphRow?.spans.find(span => span.text.includes("█"))?.fg).toEqual(RGBA.fromHex(hex));
    });
    setup.mockInput.pressKey("d");
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).toBe(standaloneTheme.id);
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(row("Standalone").text).not.toContain("*");
    expect(row("id").text.trim()).toMatch(/^id\s+custom-standalone$/);
    expect(row("base").text.trim()).toMatch(/^base\s+none \(standalone\)$/);
    expect(row("id").y).toBe(row("Standalone").y + 1);
    expect(row("base").y).toBe(row("Standalone").y + 2);
    expect(row("background").y).toBe(row("Standalone").y + 4);
    expect(setup.captureCharFrame().split("\n")[row("base").y + 1].trim()).toBe("");
    const standaloneValueEnd = row("Standalone").text.indexOf("█") - 1;
    for (const [label, value] of [
      ["id", standaloneTheme.id],
      ["base", "none (standalone)"],
    ]) {
      expect(row(label).text.indexOf(value) + value.length).toBe(standaloneValueEnd);
    }
    expect(setup.captureCharFrame()).not.toContain("*");
    expect(setup.captureCharFrame()).not.toContain("→");
    expect(row("accent").text).toMatch(/accent\s+#abcdef █/);
  } finally {
    await setup.dispose();
  }
});

test("long custom names preserve markers and long IDs wrap within details metadata", async () => {
  const custom = {
    ...derivedTheme,
    id: `long-${"x".repeat(59)}`,
    theme: { ...derivedTheme.theme, name: "x".repeat(64) },
  };
  const theme = createThemeState(custom.id, [custom]);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <ThemeDialog onClose={() => {}} />
      </ThemeContext.Provider>
    ),
    { width: 90, height: 30 },
  );
  try {
    await setup.flush();
    const appliedRow = () =>
      setup
        .captureCharFrame()
        .split("\n")
        .find(line => line.includes("✓"));
    expect(appliedRow()).not.toContain("*");
    expect(appliedRow()).not.toContain(custom.theme.name);
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(appliedRow()).toContain("*");
    expect(appliedRow()).not.toContain(custom.theme.name);
    const lines = setup.captureCharFrame().split("\n");
    const idY = lines.findIndex(line => line.trim().startsWith("id "));
    const baseY = lines.findIndex(line => line.trim().startsWith("base "));
    expect(idY).toBeGreaterThanOrEqual(0);
    expect(baseY).toBeGreaterThan(idY + 1);
    const idRows = lines.slice(idY, baseY);
    expect(idRows.map(line => line.trim().replace(/^id\s+/, "")).join("")).toBe(custom.id);
    const valueEnd = (appliedRow()?.indexOf("✓") ?? -1) - 1;
    for (const line of idRows) expect(line.trimEnd().length).toBeLessThanOrEqual(valueEnd);
  } finally {
    await setup.dispose();
  }
});

test("theme footer select hover is text-only and only left-click saves without closing", async () => {
  const theme = createThemeState();
  const originalTheme = theme.themeName();
  const [open, setOpen] = createSignal(true);
  const onClose = mock(() => setOpen(false));
  const onSelect = mock((_name: string) => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ThemeDialog onClose={onClose} onSelect={onSelect} />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40, useMouse: true, enableMouseMovement: true },
  );
  const point = (label: string) => {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y].indexOf(label) + 1, y };
  };
  const marker = (label: string, symbol: string) =>
    setup.captureSpans().lines[point(label).y]?.spans.find(s => s.text.includes(symbol));
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Predefined");
    expect(setup.captureCharFrame()).not.toContain("Custom");
    expect(marker(themes[originalTheme].name, "✓")?.bg).toEqual(RGBA.fromHex(themes[originalTheme].accent));
    expect(marker(themes[originalTheme].name, "✓")?.fg).toEqual(RGBA.fromHex(themes[originalTheme].background));
    const nord = point("Nord");
    await setup.mockMouse.moveTo(nord.x, nord.y);
    await setup.flush();
    expect(theme.themeName()).toBe(originalTheme);
    for (let step = 0; step < 3; step++) setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).toBe("nord");
    expect(theme.themeName()).not.toBe(originalTheme);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(marker(themes[originalTheme].name, "✓")?.bg).toEqual(RGBA.fromHex(themes[originalTheme].accent));
    expect(marker("Nord", "█")?.fg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker("Nord", "✓")).toBeUndefined();
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(marker("Nord", "█")?.fg).toEqual(RGBA.fromHex(themes.nord.accent));
    const { x, y } = point("enter select");
    const span = () => setup.captureSpans().lines[y]?.spans.find(s => s.text.includes("select"));
    const before = span();
    expect(before?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    await setup.mockMouse.moveTo(x, y);
    await setup.flush();
    expect(span()?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span()?.bg).toEqual(before?.bg);
    expect(onClose).not.toHaveBeenCalled();
    expect(theme.themeName()).toBe("nord");
    await setup.mockMouse.click(x, y, MouseButtons.RIGHT);
    await setup.flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(open()).toBe(true);
    expect(theme.themeName()).toBe("nord");
    expect(onSelect).not.toHaveBeenCalled();
    await setup.mockMouse.click(x, y);
    await setup.flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("nord");
    expect(open()).toBe(true);
    expect(setup.captureCharFrame()).toContain("Color Theme");
    expect(theme.themeName()).toBe("nord");
    expect(marker("Nord", "✓")?.bg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker("Nord", "✓")?.fg).toEqual(RGBA.fromHex(themes.nord.background));
    expect(marker("Nord", "█")).toBeUndefined();
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(marker("Nord", "✓")?.bg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker(themes[originalTheme].name, "✓")).toBeUndefined();
    expect(setup.captureSpans().lines[point(themes[originalTheme].name).y].spans.map(s => s.bg)).not.toContainEqual(
      RGBA.fromHex(themes[originalTheme].accent),
    );
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).not.toBe("nord");
    expect(marker("Nord", "✓")?.bg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker(theme.theme().name, "█")?.fg).toEqual(RGBA.fromHex(themes[theme.themeName()].accent));
    setup.mockInput.pressEnter();
    await setup.flush();
    const appliedTheme = theme.themeName();
    expect(marker(theme.theme().name, "✓")?.bg).toEqual(RGBA.fromHex(themes[appliedTheme].accent));
    expect(marker("Nord", "✓")).toBeUndefined();
    expect(onSelect).toHaveBeenCalledTimes(2);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    setup.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 100));
    await setup.flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe(appliedTheme);
    expect(onSelect).toHaveBeenCalledTimes(2);
  } finally {
    await setup.dispose();
  }
});

test("hover only highlights, click and Enter save without closing, close discards preview, wheel only scrolls", async () => {
  const theme = createThemeState(undefined, [derivedTheme]);
  const originalTheme = theme.themeName();
  const onSelect = mock((_name: string) => {});
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ThemeDialog onClose={() => setOpen(false)} onSelect={onSelect} />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40, useMouse: true, enableMouseMovement: true },
  );
  const lines = () => setup.captureCharFrame().split("\n");
  const point = (label: string) => {
    const y = lines().findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines()[y].indexOf(label) + 1, y };
  };
  const span = (label: string) => setup.captureSpans().lines[point(label).y]?.spans.find(s => s.text.includes(label));
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const descendants = (node: Renderable): Renderable[] =>
    node.getChildren().flatMap(child => [child, ...descendants(child)]);
  try {
    await setup.flush();
    const nord = point("Nord");
    const marker = (label: string, symbol: string) =>
      setup.captureSpans().lines[point(label).y].spans.find(s => s.text.includes(symbol));
    const originalBackground = span("Nord")?.bg;
    expect(marker("Nord", "█")).toBeUndefined();
    await setup.mockMouse.moveTo(nord.x, nord.y);
    await setup.flush();
    expect(theme.themeName()).toBe(originalTheme);
    expect(span("Nord")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(span("Nord")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    expect(marker("Nord", "█")?.fg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker(themes[originalTheme].name, "✓")).toBeDefined();
    expect(span(themes[originalTheme].name)?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(onSelect).not.toHaveBeenCalled();
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    expect(span("Nord")?.bg).toEqual(originalBackground);
    expect(span("Nord")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(marker("Nord", "█")).toBeUndefined();
    const custom = point("Custom Nord");
    await setup.mockMouse.moveTo(custom.x, custom.y);
    await setup.flush();
    expect(span("Custom Nord")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    expect(marker("Custom Nord", "█")?.fg).toEqual(RGBA.fromHex(derivedTheme.theme.accent));
    expect(theme.themeName()).toBe(originalTheme);
    expect(onSelect).not.toHaveBeenCalled();
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).toBe("tokyo-night");
    expect(onSelect).not.toHaveBeenCalled();
    await click("Nord", MouseButtons.RIGHT);
    expect(theme.themeName()).toBe("tokyo-night");
    expect(onSelect).not.toHaveBeenCalled();
    await click("Nord");
    expect(span("Nord")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(marker("Nord", "✓")?.bg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(marker("Nord", "█")).toBeUndefined();
    expect(theme.themeName()).toBe("nord");
    expect(open()).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith("nord");
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    expect(span("Nord")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    await click("Nord", MouseButtons.RIGHT);
    expect(open()).toBe(true);
    expect(theme.themeName()).toBe("nord");
    expect(onSelect).toHaveBeenCalledTimes(1);
    await click("Nord");
    expect(open()).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(2);
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(open()).toBe(true);
    expect(theme.themeName()).toBe("nord");
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith("nord");
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    const savedTheme = theme.themeName();
    expect(savedTheme).not.toBe("nord");
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(open()).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(4);
    expect(onSelect).toHaveBeenLastCalledWith(savedTheme);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).not.toBe(savedTheme);
    const close = point("esc close");
    await setup.mockMouse.moveTo(close.x, close.y);
    await setup.flush();
    expect(span("close")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span("close")?.bg).not.toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    await click("esc close", MouseButtons.RIGHT);
    expect(open()).toBe(true);
    await click("esc close");
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe(savedTheme);
    expect(onSelect).toHaveBeenCalledTimes(4);

    setOpen(true);
    setup.resize(100, 22);
    await setup.flush();
    const scrollbox = descendants(setup.renderer.root).find(
      node => node instanceof ScrollBoxRenderable,
    ) as ScrollBoxRenderable;
    expect(scrollbox).toBeDefined();
    scrollbox.scrollTo(0);
    await setup.flush();
    await setup.mockMouse.moveTo(scrollbox.x + 6, scrollbox.y + 1);
    await setup.flush();
    const top = scrollbox.scrollTop;
    await setup.mockMouse.scroll(scrollbox.x + 6, scrollbox.y + 1, "down");
    await setup.flush();
    expect(scrollbox.scrollTop).toBeGreaterThan(top);
    expect(open()).toBe(true);
    expect(theme.themeName()).toBe(savedTheme);
    expect(onSelect).toHaveBeenCalledTimes(4);
    setup.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 100));
    await setup.flush();
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe(savedTheme);
  } finally {
    await setup.dispose();
  }
});

test.each(["escape", "click"])("%s close restores the original theme when no preview was saved", async close => {
  const theme = createThemeState();
  const originalTheme = theme.themeName();
  const onSelect = mock((_name: string) => {});
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ThemeDialog onClose={() => setOpen(false)} onSelect={onSelect} />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40, useMouse: true },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).not.toBe(originalTheme);
    if (close === "escape") {
      setup.mockInput.pressEscape();
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex(line => line.includes("esc close"));
      expect(y).toBeGreaterThanOrEqual(0);
      await setup.mockMouse.click(lines[y].indexOf("esc close") + 1, y);
    }
    await setup.flush();
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe(originalTheme);
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    await setup.dispose();
  }
});

test("picker and details share capped terminal-clamped dimensions and preserve preview on d toggle", async () => {
  const theme = createThemeState();
  const onSelect = mock((_name: string) => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <ThemeDialog onClose={() => {}} onSelect={onSelect} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40 },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    const preview = theme.themeName();
    expect(preview).toBe("tokyo-night");
    for (const [width, height, dialogWidth, dialogHeight] of [
      [100, 40, 72, 32],
      [90, 30, 72, 25],
      [60, 22, 56, 18],
      [60, 14, 56, 10],
      [60, 12, 56, 8],
    ]) {
      setup.resize(width, height);
      await setup.flush();
      const dialog = setup.renderer.root.getChildren()[0].getChildren()[0];
      const bounds = () => ({ x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height });
      const pickerBounds = bounds();
      expect(dialog.width).toBe(dialogWidth);
      expect(dialog.height).toBe(dialogHeight);
      expect(dialog.y).toBeGreaterThanOrEqual(2);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(height - 2);
      setup.mockInput.pressKey("d");
      await setup.flush();
      expect(bounds()).toEqual(pickerBounds);
      expect(setup.captureCharFrame()).toContain("d themes");
      if (height >= 22) expect(setup.captureCharFrame()).toContain(themes[preview].name);
      expect(theme.themeName()).toBe(preview);
      setup.mockInput.pressKey("d");
      await setup.flush();
      expect(bounds()).toEqual(pickerBounds);
      expect(setup.captureCharFrame()).toContain("d details");
      expect(theme.themeName()).toBe(preview);
      if (height >= 22) {
        const lines = setup.captureCharFrame().split("\n");
        const selectedY = lines.findIndex(line => line.includes(themes[preview].name));
        expect(selectedY).toBeGreaterThanOrEqual(0);
        expect(
          setup.captureSpans().lines[selectedY].spans.find(s => s.text.includes(themes[preview].name))?.bg,
        ).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
      }
      expect(onSelect).not.toHaveBeenCalled();
    }
  } finally {
    await setup.dispose();
  }
});

test("details replace theme list without resizing, pin predefined metadata, and restore selection on toggle", async () => {
  const theme = createThemeState();
  const onSelect = mock((_name: string) => {});
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={{ ...theme, theme: () => ({ ...theme.theme(), accent: "#abcdef" }) }}>
        <Show when={open()}>
          <ThemeDialog onClose={() => setOpen(false)} onSelect={onSelect} />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 120, height: 40, useMouse: true, enableMouseMovement: true },
  );
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
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
    await setup.flush();
  };
  const descendants = (node: Renderable): Renderable[] =>
    node.getChildren().flatMap(child => [child, ...descendants(child)]);
  const bounds = () => ({ title: point("Color Theme"), footerY: point("enter select").y });
  try {
    await setup.flush();
    await click("Nord");
    const originalBounds = bounds();
    const badgeX = frame().split("\n")[point("Nord").y].indexOf("✓");
    const pickerSignature = setup.captureSpans().lines[point("Nord").y].spans.find(s => s.text.includes("✓"));
    expect(pickerSignature?.bg).toEqual(RGBA.fromHex(themes.nord.accent));
    expect(pickerSignature?.fg).toEqual(RGBA.fromHex(themes.nord.background));
    expect(pickerSignature?.text).toBe("✓");
    expect(theme.themeName()).toBe("nord");
    expect(frame()).not.toContain("active element");
    expect(frame()).toContain("d details");
    setup.mockInput.pressKey("p");
    await setup.flush();
    expect(frame()).toContain("d details");
    expect(frame()).not.toContain("active element");
    await click("d details", MouseButtons.RIGHT);
    expect(frame()).not.toContain("active element");
    await click("d details");
    expect(bounds()).toEqual(originalBounds);
    expect(frame()).not.toContain("HEX");
    expect(frame()).not.toContain("Preview");
    expect(frame()).not.toContain("PgUp/PgDn");
    expect(frame()).toContain("active element");
    expect(frame()).toContain("muted text");
    expect(frame()).not.toContain("Active element");
    expect(frame()).not.toContain("backgroundElementActive");
    expect(frame()).not.toContain("Catppuccin Mocha");
    const selected = point("Nord");
    expect(frame().split("\n")[selected.y].indexOf("✓")).toBe(badgeX);
    const detailsSignature = setup.captureSpans().lines[selected.y].spans.find(s => s.text.includes("✓"));
    expect(detailsSignature?.text).toBe(pickerSignature?.text);
    expect(detailsSignature?.fg).toEqual(pickerSignature?.fg);
    expect(detailsSignature?.bg).toEqual(pickerSignature?.bg);
    expect(detailsSignature?.bg).not.toEqual(RGBA.fromHex("#abcdef"));
    const metadata = () => {
      const id = point("id");
      const idRow = frame().split("\n")[id.y];
      expect(id.y).toBe(selected.y + 1);
      expect(idRow.trim()).toMatch(/^id\s+nord$/);
      expect(idRow.indexOf("nord") + "nord".length).toBe(badgeX - 1);
      expect(setup.captureSpans().lines[id.y].spans.find(s => s.text.includes("nord"))?.fg).toEqual(
        RGBA.fromHex(theme.theme().foregroundMuted),
      );
      expect(frame()).not.toMatch(/^\s*base\s/m);
    };
    metadata();
    const background = point("background");
    expect(background.y).toBe(selected.y + 3);
    expect(frame().split("\n")[selected.y + 2].trim()).toBe("");
    const backgroundRow = frame().split("\n")[background.y];
    expect(backgroundRow.indexOf("█")).toBe(badgeX);
    expect(backgroundRow.slice(badgeX - theme.theme().background.length - 1, badgeX + 1)).toBe(
      `${theme.theme().background} █`,
    );
    const backgroundSpans = setup.captureSpans().lines[background.y].spans;
    expect(backgroundSpans.find(s => s.text.includes("background"))?.fg).toEqual(
      RGBA.fromHex(theme.theme().foregroundMuted),
    );
    expect(backgroundSpans.find(s => s.text.includes(theme.theme().background))?.fg).toEqual(
      RGBA.fromHex(theme.theme().foregroundMuted),
    );
    expect(setup.captureSpans().lines[selected.y].spans.find(s => s.text.includes("Nord"))?.fg).toEqual(
      RGBA.fromHex("#abcdef"),
    );
    expect(frame()).toContain(theme.theme().background);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("nord");

    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    const accentLine = frame()
      .split("\n")
      .findIndex(line => /accent\s+#abcdef █/.test(line));
    expect(accentLine).toBeGreaterThanOrEqual(0);
    expect(setup.captureSpans().lines[accentLine].spans.find(s => s.text.includes("█"))?.fg).toEqual(
      RGBA.fromHex("#abcdef"),
    );

    expect(open()).toBe(true);
    expect(theme.themeName()).toBe("nord");
    setup.resize(90, 30);
    await setup.flush();
    const narrowBounds = bounds();
    expect(frame()).toContain("active element");
    expect(frame()).toContain("█");
    expect(frame()).not.toContain("██");
    expect(frame()).toContain("d themes");

    const scrollboxes = descendants(setup.renderer.root).filter(
      node => node instanceof ScrollBoxRenderable,
    ) as ScrollBoxRenderable[];
    expect(scrollboxes).toHaveLength(1);
    const palette = scrollboxes[0];
    palette.scrollTo(0);
    await setup.flush();
    const pinnedHeadingY = point("Nord").y;
    const pinnedIdY = point("id").y;
    let seen = frame();
    for (let page = 0; page < 8; page++) {
      setup.mockInput.pressKey("\u001b[6~");
      await setup.flush();
      seen += `\n${frame()}`;
      expect(point("Nord").y).toBe(pinnedHeadingY);
      expect(point("id").y).toBe(pinnedIdY);
      expect(frame()).toMatch(/^\s*id\s+nord\s*$/m);
      expect(frame()).not.toMatch(/^\s*base\s/m);
    }
    expect(palette.scrollTop).toBeGreaterThan(0);
    for (const [field, value] of Object.entries(theme.theme())) {
      if (field === "name") continue;
      if (Array.isArray(value)) {
        value.forEach((hex, index) => {
          expect(seen).toMatch(new RegExp(`graph color ${index + 1}\\s+${hex} █`));
        });
      } else {
        expect(seen).toContain(field === "accent" ? "#abcdef" : value);
      }
    }
    const bottom = palette.scrollTop;
    setup.mockInput.pressKey("ARROW_UP");
    await setup.flush();
    expect(palette.scrollTop).toBeLessThan(bottom);
    setup.mockInput.pressKey("\u001b[5~");
    await setup.flush();
    expect(palette.scrollTop).toBeLessThan(bottom);
    expect(theme.themeName()).toBe("nord");
    await setup.mockMouse.scroll(palette.x + 3, palette.y + 1, "up");
    await setup.flush();
    expect(open()).toBe(true);

    setup.mockInput.pressKey("p");
    await setup.flush();
    expect(frame()).toContain("d themes");
    setup.mockInput.pressKey("d");
    await setup.flush();
    expect(bounds()).toEqual(narrowBounds);
    expect(frame()).not.toContain("active element");
    expect(frame()).toContain("d details");
    for (const value of Object.values(themes)) expect(frame()).toContain(value.name);
    const nordLine = point("Nord").y;
    expect(setup.captureSpans().lines[nordLine].spans.find(s => s.text.includes("Nord"))?.bg).toEqual(
      RGBA.fromHex(theme.theme().backgroundElement),
    );
    await click("d details");
    expect(bounds()).toEqual(narrowBounds);
    expect(frame()).toContain("active element");
    expect(theme.themeName()).toBe("nord");
    setup.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 100));
    await setup.flush();
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe("nord");
    expect(onSelect).toHaveBeenCalledTimes(1);
  } finally {
    await setup.dispose();
  }
});
