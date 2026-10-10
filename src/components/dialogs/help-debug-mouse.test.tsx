import { expect, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import packageJson from "../../../package.json";
import { createThemeState, ThemeContext } from "../../context/theme";
import { addDebugEvent, clearDebugEvents } from "../../debug/events";
import DebugDialog from "./debug-dialog";
import HelpDialog from "./help-dialog";

test("Help tabs hover and click; Help and Debug support wheel and clickable close", async () => {
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
    setup.renderer.destroy();
    clearDebugEvents();
  }
});
