import { expect, mock, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createThemeState, ThemeContext } from "../../context/theme";
import OpenShiftResourceDialog from "./resource-dialog";
import type { OpenShiftResource } from "./types";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);
const logRows = (count: number) =>
  Array.from({ length: count }, (_, i) => `row-${String(i + 1).padStart(3, "0")}`).join("\n");

async function renderResource(kind: OpenShiftResource["kind"], follow = false, hasLoader = true) {
  const resource: OpenShiftResource = {
    id: `${kind}/resource`,
    kind,
    namespace: "test-ns",
    name: "test-resource",
    status: follow ? "running" : "pass",
    imageRefs: [],
  };
  const raw = `normal ${"x".repeat(180)} WRAP-END`;
  const loadLog = mock(async (_resource: OpenShiftResource, _force?: boolean) => raw);
  const loadObject = mock(async (_resource: OpenShiftResource) => ({ objectMarker: "fake-object" }));
  const streams: { signal: AbortSignal; emit: (text: string) => void; end: () => void }[] = [];
  const followLog = mock(
    (_resource: OpenShiftResource, signal: AbortSignal, emit: (text: string) => void) =>
      new Promise<void>(end => streams.push({ signal, emit, end })),
  );
  const theme = createThemeState();
  const [open, setOpen] = createSignal(true);
  const close = mock(() => setOpen(false));
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <OpenShiftResourceDialog
            resource={resource}
            loadLog={hasLoader ? loadLog : undefined}
            loadObject={loadObject}
            followLog={follow ? followLog : undefined}
            onClose={close}
          />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 110, height: 30, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  await setup.flush();
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const cell = (label: string) => {
    const { x, y } = point(label);
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const move = async (label?: string) => {
    const { x, y } = label ? point(label) : { x: 0, y: 0 };
    await setup.mockMouse.moveTo(x, y);
    await setup.flush();
  };
  const key = async (
    name: Parameters<typeof setup.mockInput.pressKey>[0],
    modifiers?: Parameters<typeof setup.mockInput.pressKey>[1],
  ) => {
    setup.mockInput.pressKey(name, modifiers);
    await setup.flush();
  };
  const scrollbox = () => {
    const node = descendants(setup.renderer.root).find(node => node instanceof ScrollBoxRenderable);
    if (!(node instanceof ScrollBoxRenderable)) throw new Error("Expected resource scrollbox");
    return node;
  };
  return {
    ...setup,
    resource,
    frame,
    cell,
    click,
    move,
    key,
    scrollbox,
    loadLog,
    loadObject,
    followLog,
    streams,
    close,
    open,
    setOpen,
    theme: theme.theme(),
  };
}

for (const kind of ["Pod", "Build"] as const) {
  test(`${kind}: clickable wrap/view/forced refresh match keyboard, text-only hover and close`, async () => {
    const d = await renderResource(kind);
    try {
      expect(d.frame()).toContain("normal");
      expect(d.frame()).not.toContain("WRAP-END");
      expect(d.loadLog.mock.calls).toEqual([[d.resource, false]]);
      const hints = descendants(d.renderer.root).filter(
        node =>
          node instanceof TextRenderable &&
          (/wrap|cycle view mode|refresh log|esc close|scroll/.test(node.plainText) || node.plainText === " · "),
      ) as TextRenderable[];
      expect(hints.length).toBeGreaterThanOrEqual(5);
      expect(hints.filter(node => node.selectable).map(node => node.plainText)).toEqual([]);
      for (const label of ["enable wrap", "cycle view mode", "refresh log", "close"]) {
        await d.move();
        const bg = d.cell(label)?.bg;
        const before = d.frame();
        await d.move(label);
        expect(d.frame()).toBe(before);
        expect(d.cell(label)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
        expect(d.cell(label)?.bg).toEqual(bg);
        await d.move();
        expect(d.cell(label)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
        await d.click(label, MouseButtons.RIGHT);
        expect(d.frame()).toBe(before);
      }
      expect(d.close).not.toHaveBeenCalled();
      expect(d.loadLog).toHaveBeenCalledTimes(1);
      expect(d.loadObject).not.toHaveBeenCalled();
      await d.click("enable wrap");
      expect(d.frame()).toContain("WRAP-END");
      expect(d.frame()).toContain("disable wrap");
      await d.key("w");
      expect(d.frame()).not.toContain("WRAP-END");
      await d.click("refresh log");
      await d.key("r");
      expect(d.loadLog.mock.calls).toEqual([
        [d.resource, false],
        [d.resource, true],
        [d.resource, true],
      ]);
      await d.click("cycle view mode");
      expect(d.frame()).toContain("fake-object");
      expect(d.scrollbox().stickyScroll).toBe(false);
      expect(d.loadObject.mock.calls).toEqual([[d.resource]]);
      // Existing snapshot refresh in object view reloads the log, not the object.
      await d.click("refresh log");
      await d.key("r");
      expect(d.loadObject).toHaveBeenCalledTimes(1);
      expect(d.loadLog.mock.calls.slice(-2)).toEqual([
        [d.resource, true],
        [d.resource, true],
      ]);
      expect(d.frame()).toContain("fake-object");
      await d.key("c");
      expect(d.frame()).toContain("normal");
      expect(d.scrollbox().stickyScroll).toBe(true);
      expect(d.loadLog.mock.calls.at(-1)).toEqual([d.resource, false]);
      await d.click("esc close");
      expect(d.open()).toBe(false);
      d.setOpen(true);
      await d.flush();
      await d.key("ESCAPE");
      expect(d.open()).toBe(false);
      expect(d.close).toHaveBeenCalledTimes(2);
    } finally {
      d.renderer.destroy();
    }
  });
}

test("non-log resources and missing log loader expose no log controls", async () => {
  for (const [kind, hasLoader] of [
    ["Deployment", true],
    ["Pod", false],
    ["Build", false],
  ] as const) {
    const d = await renderResource(kind, false, hasLoader);
    try {
      expect(d.frame()).not.toContain("cycle view mode");
      expect(d.frame()).not.toContain("refresh log");
      const before = d.frame();
      await d.key("c");
      await d.key("r");
      expect(d.frame()).toBe(before);
      expect(d.loadLog).not.toHaveBeenCalled();
      expect(d.followLog).not.toHaveBeenCalled();
      if (kind === "Deployment") {
        expect(d.frame()).toContain("fake-object");
        expect(d.loadObject.mock.calls).toEqual([[d.resource]]);
      }
      await d.click("enable wrap");
      expect(d.frame()).toContain("disable wrap");
      await d.click("esc close");
      expect(d.open()).toBe(false);
    } finally {
      d.renderer.destroy();
    }
  }
});

for (const kind of ["Pod", "Build"] as const) {
  test(`${kind}: follow restart, view abort, completion and close cleanup preserve lifecycle`, async () => {
    const d = await renderResource(kind, true);
    try {
      expect(d.followLog).toHaveBeenCalledTimes(1);
      expect(d.loadLog).not.toHaveBeenCalled();
      d.streams[0].emit("live-output");
      await d.flush();
      expect(d.frame()).toContain("live-output");
      await d.click("refresh log", MouseButtons.RIGHT);
      expect(d.streams[0].signal.aborted).toBe(false);
      await d.click("refresh log");
      expect(d.streams[0].signal.aborted).toBe(true);
      expect(d.followLog).toHaveBeenCalledTimes(2);
      d.streams[0].end();
      await d.flush();
      expect(d.frame()).not.toContain("log ended");
      expect(d.loadLog).not.toHaveBeenCalled();
      await d.key("r");
      expect(d.streams[1].signal.aborted).toBe(true);
      expect(d.followLog).toHaveBeenCalledTimes(3);
      await d.click("cycle view mode");
      expect(d.streams[2].signal.aborted).toBe(true);
      expect(d.frame()).toContain("fake-object");
      // Existing follow refresh in object view reruns the object effect.
      await d.click("refresh log");
      await d.key("r");
      expect(d.loadObject).toHaveBeenCalledTimes(3);
      expect(d.followLog).toHaveBeenCalledTimes(3);
      await d.key("c");
      expect(d.followLog).toHaveBeenCalledTimes(4);
      d.streams[3].emit("final-live-output");
      d.streams[3].end();
      await d.flush();
      expect(d.frame()).toContain("log ended");
      expect(d.loadLog.mock.calls).toEqual(kind === "Build" ? [[d.resource, false]] : []);
      await d.click("refresh log");
      expect(d.frame()).not.toContain("log ended");
      expect(d.streams[4].signal.aborted).toBe(false);
      await d.click("esc close");
      expect(d.streams[4].signal.aborted).toBe(true);
      d.setOpen(true);
      await d.flush();
      await d.key("ESCAPE");
      expect(d.streams[5].signal.aborted).toBe(true);
      expect(d.close).toHaveBeenCalledTimes(2);
    } finally {
      d.renderer.destroy();
    }
  });
}

test("native wheel and keyboard share scroll position and suspend/resume sticky log following", async () => {
  const d = await renderResource("Pod", true);
  try {
    const sb = d.scrollbox();
    d.streams[0].emit(logRows(100));
    await d.flush();
    expect(d.frame()).toContain("row-100");
    const bottom = sb.scrollTop;
    await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "up");
    await d.flush();
    expect(sb.scrollTop).toBeLessThan(bottom);
    const wheelTop = sb.scrollTop;
    d.streams[0].emit(logRows(110));
    await d.flush();
    expect(sb.scrollTop).toBe(wheelTop);
    await d.key("k");
    expect(sb.scrollTop).toBe(wheelTop - 1);
    await d.key("j");
    expect(sb.scrollTop).toBe(wheelTop);
    await d.key("ARROW_UP", { shift: true });
    expect(sb.scrollTop).toBe(wheelTop - 10);
    await d.key("ARROW_DOWN", { shift: true });
    expect(sb.scrollTop).toBe(wheelTop);
    await d.key("g");
    expect(sb.scrollTop).toBe(0);
    await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "down");
    await d.flush();
    expect(sb.scrollTop).toBeGreaterThan(0);
    await d.key("g");
    expect(sb.scrollTop).toBe(0);
    d.streams[0].emit(logRows(120));
    await d.flush();
    expect(sb.scrollTop).toBe(0);
    await d.key("g", { shift: true });
    expect(d.frame()).toContain("row-120");
    d.streams[0].emit(logRows(130));
    await d.flush();
    expect(d.frame()).toContain("row-130");
    await d.click("cycle view mode");
    expect(sb.stickyScroll).toBe(false);
    await d.key("c");
    d.streams[1].emit(logRows(140));
    await d.flush();
    expect(sb.stickyScroll).toBe(true);
    expect(d.frame()).toContain("row-140");
  } finally {
    d.renderer.destroy();
  }
});
