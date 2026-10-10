import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createThemeState, ThemeContext } from "../../context/theme";
import ThemeDialog from "./theme-dialog";

test("theme footer confirm hover is text-only and left-click preserves the hovered preview on close", async () => {
  const theme = createThemeState();
  const originalTheme = theme.themeName();
  const [open, setOpen] = createSignal(true);
  const onClose = mock(() => setOpen(false));
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ThemeDialog onClose={onClose} />
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
  try {
    await setup.flush();
    const nord = point("Nord");
    await setup.mockMouse.moveTo(nord.x, nord.y);
    await setup.flush();
    expect(theme.themeName()).toBe("nord");
    expect(theme.themeName()).not.toBe(originalTheme);
    const { x, y } = point("confirm");
    const span = () => setup.captureSpans().lines[y]?.spans.find(s => s.text.includes("confirm"));
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
    await setup.mockMouse.click(x, y);
    await setup.flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(open()).toBe(false);
    expect(setup.captureCharFrame()).not.toContain("Color Theme");
    expect(theme.themeName()).toBe("nord");
  } finally {
    setup.renderer.destroy();
  }
});

test("theme rows hover-preview and confirm; clickable close cancels; wheel scrolls without confirming", async () => {
  const theme = createThemeState();
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ThemeDialog onClose={() => setOpen(false)} />
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
    await setup.mockMouse.moveTo(nord.x, nord.y);
    await setup.flush();
    expect(span("Nord")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    expect(theme.themeName()).toBe("nord");
    await setup.mockMouse.moveTo(0, 0);
    await setup.flush();
    expect(span("Nord")?.bg).toEqual(RGBA.fromHex(theme.theme().backgroundElement));
    await click("Nord", MouseButtons.RIGHT);
    expect(open()).toBe(true);
    expect(theme.themeName()).toBe("nord");
    await click("Nord");
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe("nord");

    setOpen(true);
    await setup.flush();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.flush();
    expect(theme.themeName()).not.toBe("nord");
    const close = point("esc close");
    await setup.mockMouse.moveTo(close.x, close.y);
    await setup.flush();
    expect(span("close")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span("close")?.bg).not.toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    await click("esc close", MouseButtons.RIGHT);
    expect(open()).toBe(true);
    await click("esc close");
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe("nord");

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
    setup.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 100));
    await setup.flush();
    expect(open()).toBe(false);
    expect(theme.themeName()).toBe("nord");
  } finally {
    setup.renderer.destroy();
  }
});
