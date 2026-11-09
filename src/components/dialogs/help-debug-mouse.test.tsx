import { expect, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import packageJson from "../../../package.json";
import { createThemeState, ThemeContext } from "../../context/theme";
import { addDebugEvent, clearDebugEvents } from "../../debug/events";
import { KEYBINDS } from "../../keybinds";
import DebugDialog from "./debug-dialog";
import HelpDialog from "./help-dialog";

test("Help tabs hover and click. Help and Debug support wheel and clickable close", async () => {
  const theme = createThemeState();
  const [dialog, setDialog] = createSignal<"help" | "debug" | null>("help");
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={dialog() === "help"}>
          <HelpDialog onClose={() => setDialog(null)} />
        </Show>
        <Show when={dialog() === "debug"}>
          <DebugDialog gitColor={theme.theme().gitBg} onClose={() => setDialog(null)} />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 110, height: 30, useMouse: true, enableMouseMovement: true },
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
    const sections = KEYBINDS.general.filter(row => row.kind === "section").map(row => row.label);
    expect(sections).toContain("Color Theme");
    expect(sections).not.toContain("Theme inspector");
    expect(sections).not.toContain("Configuration and Windows");
    const themeStart = KEYBINDS.general.findIndex(row => row.kind === "section" && row.label === "Color Theme");
    const themeEnd = KEYBINDS.general.findIndex(row => row.kind === "section" && row.label === "Help");
    const themeKeys = KEYBINDS.general
      .slice(themeStart + 1, themeEnd)
      .filter(row => row.kind === "binding")
      .map(row => row.key);
    expect(themeKeys).toEqual(["↑/↓  or  j/k", "shift ↑/↓", "enter", "esc", "d", "PgUp/PgDn"]);
    const header = lines().find(line => line.includes("esc close"));
    expect(header).toContain("Help");
    expect(header).not.toContain("codepulse");
    expect(setup.captureCharFrame()).toContain(`codepulse v${packageJson.version}`);
    const versionRow = point(`codepulse v${packageJson.version}`).y;
    expect(lines()[versionRow]).toContain("switch tab");
    expect(lines()[versionRow]).toContain("scroll");
    expect(span("General")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    const commands = point("Commands");
    const tabBorderColor = () => {
      let column = 0;
      return setup.captureSpans().lines[commands.y - 1]?.spans.find(span => {
        column += span.text.length;
        return column > commands.x;
      })?.fg;
    };
    await setup.mockMouse.moveTo(commands.x, commands.y);
    await setup.flush();
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(tabBorderColor()).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span("General")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    expect(tabBorderColor()).toEqual(RGBA.fromHex(theme.theme().border));
    await click("Commands", MouseButtons.RIGHT);
    expect(span("General")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await click("Commands");
    expect(setup.captureCharFrame()).toContain(`codepulse v${packageJson.version}`);
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    expect(tabBorderColor()).toEqual(RGBA.fromHex(theme.theme().accent));
    await setup.mockMouse.click(commands.x, commands.y + 1);
    await setup.flush();
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    const providers = point("Providers");
    await setup.mockMouse.click(providers.x, providers.y + 1);
    await setup.flush();
    expect(span("Providers")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await setup.mockMouse.click(commands.x, commands.y - 1);
    await setup.flush();
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await click("Providers");
    expect(span("Providers")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.flush();
    expect(span("Commands")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await click("General");
    for (const kind of ["help", "debug"] as const) {
      if (kind === "debug") {
        for (let i = 0; i < 30; i++) addDebugEvent({ source: "Git", message: `Mouse test event ${i}` });
        setDialog("debug");
        await setup.flush();
      }
      const scrollbox = descendants(setup.renderer.root).find(
        node => node instanceof ScrollBoxRenderable,
      ) as ScrollBoxRenderable;
      const top = scrollbox.scrollTop;
      await setup.mockMouse.scroll(scrollbox.x + 6, scrollbox.y + 1, "down");
      await setup.flush();
      expect(scrollbox.scrollTop).toBeGreaterThan(top);
      const close = point("esc close");
      await setup.mockMouse.moveTo(close.x, close.y);
      await setup.flush();
      expect(span("close")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
      expect(span("close")?.bg).not.toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
      await click("esc close", MouseButtons.RIGHT);
      expect(dialog()).toBe(kind);
      await click("esc close");
      expect(dialog()).toBeNull();
    }
  } finally {
    try {
      await setup.dispose();
    } finally {
      clearDebugEvents();
    }
  }
});

test("Debug colours an error red whatever its source", async () => {
  const theme = createThemeState();
  clearDebugEvents();
  addDebugEvent({ source: "GitHub", message: "provider request failed", status: "error" });
  addDebugEvent({ source: "Git", message: "plain git event" });
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <DebugDialog gitColor={theme.theme().gitBg} onClose={() => {}} />
      </ThemeContext.Provider>
    ),
    { width: 110, height: 30 },
  );
  try {
    await setup.flush();
    const spanOf = (text: string) => {
      const y = setup
        .captureCharFrame()
        .split("\n")
        .findIndex(line => line.includes(text));
      return setup.captureSpans().lines[y]?.spans.find(span => span.text.includes(text));
    };
    expect(spanOf("provider request failed")?.fg).toEqual(RGBA.fromHex(theme.theme().error));
    expect(spanOf("plain git event")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
  } finally {
    clearDebugEvents();
    setup.renderer.destroy();
  }
});

test("Debug marks a failed command or request in the status column", async () => {
  const theme = createThemeState();
  clearDebugEvents();
  addDebugEvent({ source: "Git", message: "git fetch --all --prune", status: "exit 128" });
  addDebugEvent({ source: "GitHub", message: "GET /runs", status: "401" });
  addDebugEvent({ source: "Snyk", message: "snyk test (failed)", status: "2" });
  addDebugEvent({ source: "Snyk", message: "snyk test (vulnerable)", status: "1" });
  addDebugEvent({ source: "GitHub", message: "POST /graphql", status: "200" });
  addDebugEvent({ source: "Git", message: "git status", status: "ok" });
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <DebugDialog gitColor={theme.theme().gitBg} onClose={() => {}} />
      </ThemeContext.Provider>
    ),
    { width: 110, height: 30 },
  );
  try {
    await setup.flush();
    const statusOf = (message: string, status: string) => {
      const y = setup
        .captureCharFrame()
        .split("\n")
        .findIndex(line => line.includes(message));
      return setup.captureSpans().lines[y]?.spans.find(span => span.text.trim() === status);
    };
    const error = RGBA.fromHex(theme.theme().error);
    const muted = RGBA.fromHex(theme.theme().foregroundMuted);
    expect(statusOf("git fetch --all --prune", "exit 128")?.fg).toEqual(error);
    expect(statusOf("GET /runs", "401")?.fg).toEqual(error);
    expect(statusOf("snyk test (failed)", "2")?.fg).toEqual(error);
    // Snyk exits 1 when it finds vulnerabilities: a result, not a failure.
    expect(statusOf("snyk test (vulnerable)", "1")?.fg).toEqual(muted);
    expect(statusOf("POST /graphql", "200")?.fg).toEqual(muted);
    expect(statusOf("git status", "ok")?.fg).toEqual(muted);
    // The command line itself stays readable; only error events turn the message red.
    expect(
      setup.captureSpans().lines[
        setup
          .captureCharFrame()
          .split("\n")
          .findIndex(line => line.includes("git fetch --all --prune"))
      ]?.spans.find(span => span.text.includes("git fetch"))?.fg,
    ).toEqual(RGBA.fromHex(theme.theme().foreground));
  } finally {
    clearDebugEvents();
    setup.renderer.destroy();
  }
});
