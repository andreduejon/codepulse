import { expect, spyOn, test } from "bun:test";
import { type BoxRenderable, InputRenderable, type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import * as config from "../config";
import { createThemeState, ThemeContext } from "../context/theme";
import ProjectSelector from "./project-selector";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

test("repo selector hover, mouse selection, path draft, Escape and keyboard share in-app behavior", async () => {
  const theme = createThemeState();
  const selected: string[] = [];
  const [open, setOpen] = createSignal(true);
  let cancelled = 0;
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ProjectSelector
            knownRepos={[
              { path: "/repo/mouse-alpha", appName: "Alpha", group: "Group A" },
              { path: "/repo/mouse-beta", appName: "Beta", group: "Group A" },
              { path: "/repo/mouse-current", appName: "Current", group: "Group B" },
            ]}
            currentRepo="/repo/mouse-current"
            onSelectRepo={path => selected.push(path)}
            onCancel={() => {
              cancelled++;
              setOpen(false);
            }}
          />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 110, height: 40, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const point = (label: string) => {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y].indexOf(label) + 1, y };
  };
  const span = (label: string) => setup.captureSpans().lines[point(label).y]?.spans.find(s => s.text.includes(label));
  const move = async (label?: string) => {
    const { x, y } = label ? point(label) : { x: 0, y: 0 };
    await setup.mockMouse.moveTo(x, y);
    await setup.flush();
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const key = async (name: Parameters<typeof setup.mockInput.pressKey>[0]) => {
    setup.mockInput.pressKey(name);
    await setup.flush();
  };
  const remove = spyOn(config, "removeRepoConfig").mockReturnValue(true);
  const destroy = spyOn(setup.renderer, "destroy");
  try {
    await setup.flush();
    const input = descendants(setup.renderer.root).find(node => node instanceof InputRenderable) as InputRenderable;
    const highlight = RGBA.fromHex(theme.theme().backgroundElement);
    expect(span("Alpha")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await move("Beta");
    expect(span("Beta")?.bg).toEqual(highlight);
    expect(span("Alpha")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    expect(input.focused).toBe(false);
    expect(selected).toEqual([]);
    await move();
    expect(span("Beta")?.bg).not.toEqual(highlight);
    await move("Enter custom path...");
    expect((input.parent as BoxRenderable).backgroundColor).toEqual(highlight);
    expect(input.focused).toBe(false);
    await move();
    expect((input.parent as BoxRenderable).backgroundColor).not.toEqual(highlight);

    for (const label of ["Group A", "Group B", "Current (current)"]) {
      await move(label);
      expect(span(label)?.bg).not.toEqual(highlight);
      await click(label);
      expect(span("Alpha")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    }
    const group = point("Group B");
    await setup.mockMouse.click(group.x, group.y - 1);
    await setup.flush();
    expect(span("Alpha")?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
    await click("Beta", MouseButtons.RIGHT);
    expect(selected).toEqual([]);
    await click("Beta");
    expect(selected).toEqual(["/repo/mouse-beta"]);
    await key("RETURN");
    expect(selected).toEqual(["/repo/mouse-beta", "/repo/mouse-beta"]);
    await key("ARROW_UP");
    await key("RETURN");
    expect(selected.at(-1)).toBe("/repo/mouse-alpha");
    await key("ARROW_DOWN");
    await key("ARROW_DOWN");
    expect(input.focused).toBe(true);
    await key("ESCAPE");
    expect(input.focused).toBe(false);

    await click("Enter custom path...", MouseButtons.RIGHT);
    expect(input.focused).toBe(false);
    await click("Enter custom path...");
    expect(input.focused).toBe(true);
    await setup.mockInput.typeText("/repo/draft-jkq");
    await setup.flush();
    await move("Beta");
    expect(input.focused).toBe(true);
    expect(input.value).toBe("/repo/draft-jkq");
    await setup.mockInput.typeText("-more");
    await setup.flush();
    expect(input.value).toBe("/repo/draft-jkq-more");
    await setup.mockMouse.click(input.x + 2, input.y);
    await setup.flush();
    expect(input.cursorOffset).toBe(2);
    expect(input.value).toBe("/repo/draft-jkq-more");
    await move("esc list");
    expect(span("list")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span("list")?.bg).not.toEqual(highlight);
    await move();
    expect(span("list")?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    await click("esc list", MouseButtons.RIGHT);
    expect(input.focused).toBe(true);
    expect(input.value).toBe("/repo/draft-jkq-more");
    await click("esc list");
    expect(input.focused).toBe(false);
    expect(input.value).toBe("");
    expect(cancelled).toBe(0);
    await click("Enter custom path...");
    await setup.mockInput.typeText("/repo/keyboard-draft");
    await key("ESCAPE");
    expect(input.value).toBe("");
    expect(input.focused).toBe(false);
    await click("Enter custom path...");
    await setup.mockInput.typeText("/repo/mouse-custom");
    await setup.flush();
    const selections = selected.length;
    await move("enter open");
    expect(selected).toHaveLength(selections);
    await click("enter open", MouseButtons.RIGHT);
    expect(selected).toHaveLength(selections);
    expect(input.value).toBe("/repo/mouse-custom");
    await click("enter open");
    expect(selected).toHaveLength(selections + 1);
    expect(selected.at(-1)).toBe("/repo/mouse-custom");
    await key("RETURN");
    expect(selected.at(-1)).toBe("/repo/mouse-custom");
    await key("ESCAPE");

    await move("Beta");
    await move("f forget");
    expect(remove).not.toHaveBeenCalled();
    await click("f forget", MouseButtons.RIGHT);
    expect(remove).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).toContain("Alpha");
    await click("f forget");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("/repo/mouse-alpha");
    expect(setup.captureCharFrame()).not.toContain("Alpha");
    expect(setup.captureCharFrame()).toContain("Beta");
    await click("esc back", MouseButtons.RIGHT);
    expect(cancelled).toBe(0);
    await click("esc back");
    expect(cancelled).toBe(1);
    expect(open()).toBe(false);
    setOpen(true);
    await setup.flush();
    await key("ESCAPE");
    expect(cancelled).toBe(2);
    setOpen(true);
    await setup.flush();
    await move("q quit");
    expect(destroy).not.toHaveBeenCalled();
    await click("q quit", MouseButtons.RIGHT);
    expect(destroy).not.toHaveBeenCalled();
    const quit = point("q quit");
    await setup.mockMouse.click(quit.x, quit.y);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(2);
  } finally {
    destroy.mockRestore();
    setup.renderer.destroy();
    remove.mockRestore();
  }
});

test("Escape closes a focused path input when there are no saved repos", async () => {
  const theme = createThemeState();
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <ProjectSelector
            knownRepos={[]}
            currentRepo="/repo/mouse-current"
            onSelectRepo={() => {}}
            onCancel={() => setOpen(false)}
          />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 110, height: 40, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const input = descendants(setup.renderer.root).find(node => node instanceof InputRenderable) as InputRenderable;
    expect(input.focused).toBe(true);
    await setup.mockInput.typeText("/repo/no-saved-draft");
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("esc back"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(lines[y].indexOf("esc back") + 1, y);
    await setup.flush();
    expect(open()).toBe(false);
    setOpen(true);
    await setup.flush();
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(open()).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("repo selector wheel scrolls and keyboard reaches the path row", async () => {
  const theme = createThemeState();
  const selected: string[] = [];
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <ProjectSelector
          knownRepos={Array.from({ length: 30 }, (_, i) => ({
            path: `/repo/mouse-scroll-${i}`,
            appName: `Repo ${String(i).padStart(2, "0")}`,
            group: "Scrollable repos",
          }))}
          currentRepo="/repo/mouse-other"
          onSelectRepo={path => selected.push(path)}
          onCancel={() => {}}
        />
      </ThemeContext.Provider>
    ),
    { width: 110, height: 40, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const nodes = descendants(setup.renderer.root);
    const scrollbox = nodes.find(node => node instanceof ScrollBoxRenderable) as ScrollBoxRenderable;
    const input = nodes.find(node => node instanceof InputRenderable) as InputRenderable;
    await setup.mockMouse.scroll(scrollbox.x + 6, scrollbox.y + 2, "down");
    await setup.flush();
    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(selected).toEqual([]);
    const top = scrollbox.scrollTop;
    await setup.mockMouse.scroll(scrollbox.x + 6, scrollbox.y + 2, "up");
    await setup.flush();
    expect(scrollbox.scrollTop).toBeLessThan(top);
    for (let i = 0; i < 30; i++) {
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.flush();
    }
    expect(input.focused).toBe(true);
    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(setup.captureCharFrame()).toContain("Enter custom path...");
    setup.mockInput.pressKey("ESCAPE");
    await setup.flush();
    expect(input.focused).toBe(false);
    expect(scrollbox.scrollTop).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
