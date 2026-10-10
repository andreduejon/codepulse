import { expect, mock, spyOn, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as repo from "../../git/repo";
import type { BlameLine, DiffLine, DiffTarget } from "../../git/types";
import DiffBlameDialog from "./diff-blame-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderDiff(long = false) {
  const lines: DiffLine[] = long
    ? Array.from({ length: 200 }, (_, i) => ({
        type: "context",
        content: `row-${String(i + 1).padStart(3, "0")}`,
        oldLineNo: i + 1,
        newLineNo: i + 1,
      }))
    : [
        { type: "context", content: `shared ${"x".repeat(110)} WRAP-END`, oldLineNo: 2, newLineNo: 2 },
        { type: "delete", content: "removed-line", oldLineNo: 3 },
        { type: "add", content: "added-line", newLineNo: 3 },
      ];
  const diffSpy = spyOn(repo, "getFileDiff").mockImplementation(async (_repo, _hash, filePath) => ({
    filePath,
    isBinary: false,
    hunks: [{ oldStart: 2, oldCount: 2, newStart: 2, newCount: 2, header: "@@ -2,2 +2,2 @@", lines }],
  }));
  const contentSpy = spyOn(repo, "getFileContent").mockImplementation(async (_repo, _hash, filePath) => ({
    filePath,
    isBinary: false,
    lines: long
      ? lines.map(line => line.content)
      : ["file-only-before", lines[0].content, "added-line", "file-only-after"],
  }));
  const annotations = (author: string): BlameLine[] => [
    { commitHash: "abc123456", shortHash: "abc1234", author, lineNo: 2, content: lines[0].content },
  ];
  const blameSpy = spyOn(repo, "getFileBlame").mockImplementation(async (_repo, _hash, filePath) =>
    annotations(filePath === "first.ts" ? "Alice" : "Bob"),
  );
  const theme = createThemeState();
  const [target, setTarget] = createSignal<DiffTarget>({
    commitHash: "123456789",
    filePath: "first.ts",
    fileIndex: 0,
    fileList: ["first.ts", "second.ts"],
    source: "commit",
  });
  const [open, setOpen] = createSignal(true);
  const close = mock(() => setOpen(false));
  const navigate = mock((next: DiffTarget) => setTarget(next));
  const restore = () => {
    diffSpy.mockRestore();
    contentSpy.mockRestore();
    blameSpy.mockRestore();
  };
  let setup: Awaited<ReturnType<typeof testRender>>;
  try {
    setup = await testRender(
      () => {
        const app = createAppState(100, 0, 0);
        app.actions.setRepoPath("/repo/diff-mouse");
        return (
          <ThemeContext.Provider value={theme}>
            <AppStateContext.Provider value={app}>
              <Show when={open()}>
                <DiffBlameDialog target={target()} onClose={close} onNavigate={navigate} />
              </Show>
            </AppStateContext.Provider>
          </ThemeContext.Provider>
        );
      },
      { width: 80, height: 30, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
    );
    await setup.flush();
  } catch (error) {
    restore();
    throw error;
  }
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
    if (!(node instanceof ScrollBoxRenderable)) throw new Error("Expected diff scrollbox");
    return node;
  };
  const rowTexts = () =>
    descendants(scrollbox()).flatMap(node => (node instanceof TextRenderable ? [node.plainText] : []));
  return {
    ...setup,
    frame,
    point,
    cell,
    click,
    move,
    key,
    scrollbox,
    rowTexts,
    target,
    setTarget,
    open,
    setOpen,
    close,
    navigate,
    diffSpy,
    contentSpy,
    blameSpy,
    annotations,
    theme: theme.theme(),
    dispose: () => {
      setup.renderer.destroy();
      restore();
    },
  };
}

test("diff footer mouse actions share keyboard toggles, text-only hover and close at minimum width", async () => {
  const d = await renderDiff();
  try {
    expect(d.diffSpy).toHaveBeenCalledTimes(1);
    expect(d.contentSpy).toHaveBeenCalledTimes(1);
    expect(d.blameSpy).not.toHaveBeenCalled();
    expect(d.frame()).toContain("unified");
    expect(d.frame()).toContain("removed-line");
    expect(d.frame()).toContain("added-line");
    expect(d.rowTexts()).toContain("  ↵ ");
    for (const label of ["blame", "file", "view", "nowrap", "next", "close"]) {
      // Match the footer file action rather than the title path.
      const hint = label === "file" ? "v file" : label;
      await d.move();
      const bg = d.cell(hint === "v file" ? " file" : hint)?.bg;
      await d.move(hint);
      const description = hint === "v file" ? " file" : hint;
      expect(d.cell(description)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
      expect(d.cell(description)?.bg).toEqual(bg);
      await d.move();
      expect(d.cell(description)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
      const before = d.frame();
      await d.click(hint, MouseButtons.RIGHT);
      expect(d.frame()).toBe(before);
    }
    expect(d.blameSpy).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.close).not.toHaveBeenCalled();

    await d.click("b blame");
    expect(d.frame()).toContain("Alice");
    await d.key("b");
    expect(d.frame()).not.toContain("Alice");
    await d.key("b");
    expect(d.frame()).toContain("Alice");
    expect(d.blameSpy).toHaveBeenCalledTimes(1);
    await d.click("b hide");

    await d.click("c view");
    expect(d.frame()).toContain("new only");
    expect(d.frame()).not.toContain("removed-line");
    expect(d.frame()).toContain("added-line");
    await d.key("c");
    expect(d.frame()).toContain("old only");
    expect(d.frame()).toContain("removed-line");
    expect(d.frame()).not.toContain("added-line");
    await d.click("c view");
    expect(d.frame()).toContain("unified");

    await d.click("v file");
    expect(d.frame()).toContain("file-only-before");
    expect(d.frame()).toContain("file-only-after");
    await d.key("v");
    expect(d.frame(), "keyboard v returns to hunks").not.toContain("file-only-before");
    expect(d.frame()).toContain("Lines 2");
    await d.click("w nowrap");
    expect(d.rowTexts(), "mouse w removes continuation rows").not.toContain("  ↵ ");
    expect(d.frame(), "nowrap clips the long line").not.toContain("WRAP-END");
    await d.key("w");
    expect(d.rowTexts()).toContain("  ↵ ");
    expect(d.frame()).toContain("WRAP-END");
    await d.click("esc close");
    expect(d.open(), "mouse close unmounts dialog").toBe(false);
    expect(d.close).toHaveBeenCalledTimes(1);
    d.setOpen(true);
    await d.flush();
    await d.key("ESCAPE");
    expect(d.open(), "Escape closes reopened dialog").toBe(false);
    expect(d.close).toHaveBeenCalledTimes(2);
  } finally {
    d.dispose();
  }
});

test("file arrows respect boundaries and lazy blame follows reactive targets, cancelling stale requests", async () => {
  const d = await renderDiff();
  try {
    const boundary = async (label: string, key: "ARROW_LEFT" | "ARROW_RIGHT") => {
      await d.move();
      const before = d.cell(label);
      const arrow = label === "prev" ? "←" : "→";
      const arrowText = descendants(d.renderer.root).find(
        node => node instanceof TextRenderable && node.plainText === arrow,
      ) as TextRenderable;
      expect(arrowText.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
      expect(before?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
      const count = d.navigate.mock.calls.length;
      await d.move(label);
      expect(d.cell(label)?.fg).toEqual(before?.fg);
      expect(d.cell(label)?.bg).toEqual(before?.bg);
      await d.click(label);
      await d.key(key);
      expect(d.navigate).toHaveBeenCalledTimes(count);
    };
    await boundary("prev", "ARROW_LEFT");
    await d.click("→ next");
    expect(d.target().fileIndex).toBe(1);
    expect(d.frame()).toContain("second.ts");
    expect(d.blameSpy).not.toHaveBeenCalled();
    await boundary("next", "ARROW_RIGHT");
    await d.click("← prev");
    expect(d.target().fileIndex).toBe(0);

    let resolveBlame!: (lines: BlameLine[]) => void;
    d.blameSpy.mockImplementationOnce(() => new Promise(resolve => (resolveBlame = resolve)));
    await d.click("b blame");
    expect(d.frame()).toContain("loading...");
    const signal = d.blameSpy.mock.calls[0][4];
    await d.click("b hide");
    await d.click("b blame");
    expect(d.blameSpy).toHaveBeenCalledTimes(1);
    await d.click("→ next");
    expect(signal?.aborted).toBe(true);
    expect(d.blameSpy).toHaveBeenCalledTimes(2);
    expect(d.frame()).toContain("Bob");
    expect(d.frame()).not.toContain("Alice");
    resolveBlame(d.annotations("Stale"));
    await d.flush();
    expect(d.frame()).not.toContain("Stale");
    expect(d.frame()).toContain("Bob");
    await d.key("b");
    await d.key("b");
    expect(d.blameSpy).toHaveBeenCalledTimes(2);
    await d.key("h");
    expect(d.target().fileIndex).toBe(0);
    expect(d.frame()).toContain("Alice");
    expect(d.blameSpy).toHaveBeenCalledTimes(3);
    await d.key("l");
    expect(d.target().fileIndex).toBe(1);
    expect(d.blameSpy).toHaveBeenCalledTimes(4);
    expect(d.blameSpy).toHaveBeenLastCalledWith(
      "/repo/diff-mouse",
      "123456789",
      "second.ts",
      "commit",
      expect.any(AbortSignal),
    );
    await d.key("ARROW_LEFT");
    expect(d.target().fileIndex).toBe(0);
    await d.key("ARROW_RIGHT");
    expect(d.target().fileIndex).toBe(1);
    d.setTarget({ ...d.target(), fileList: ["second.ts"], fileIndex: 0 });
    await d.flush();
    expect(d.frame()).not.toContain("prev");
    expect(d.frame()).not.toContain("next");
  } finally {
    d.dispose();
  }
});

test("native wheel updates the rendered diff window; keyboard scrolling and toggle/navigation resets remain", async () => {
  const d = await renderDiff(true);
  try {
    const sb = d.scrollbox();
    expect(d.rowTexts()).toContain("row-001");
    expect(d.rowTexts()).not.toContain("row-100");
    expect(d.rowTexts().length).toBeLessThan(400);
    for (let i = 0; i < 50; i++) await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "down");
    await d.flush();
    expect(sb.scrollTop).toBeGreaterThan(30);
    expect(d.frame()).not.toContain("row-001");
    expect(d.rowTexts()).not.toContain("row-001");
    expect(d.blameSpy).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    const wheelTop = sb.scrollTop;
    await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "up");
    await d.flush();
    expect(sb.scrollTop).toBeLessThan(wheelTop);
    const top = sb.scrollTop;
    await d.key("j");
    expect(sb.scrollTop).toBe(top + 1);
    await d.key("k");
    expect(sb.scrollTop).toBe(top);
    await d.key("j", { shift: true });
    expect(sb.scrollTop).toBe(top + 10);
    await d.key("k", { shift: true });
    expect(sb.scrollTop).toBe(top);
    await d.key("g", { shift: true });
    expect(d.frame()).toContain("row-200");
    expect(d.rowTexts()).not.toContain("row-001");
    await d.key("g");
    expect(sb.scrollTop).toBe(0);
    await d.key("ARROW_DOWN");
    expect(sb.scrollTop).toBe(1);
    await d.key("ARROW_UP");
    expect(sb.scrollTop).toBe(0);
    await d.key("j");
    await d.click("c view");
    expect(d.scrollbox().scrollTop).toBe(0);
    await d.key("j");
    await d.click("v file");
    expect(d.scrollbox().scrollTop).toBe(0);
    await d.key("j");
    await d.click("→ next");
    expect(d.scrollbox().scrollTop).toBe(0);
    expect(d.frame()).toContain("row-001");
    expect(d.rowTexts()).not.toContain("row-100");
  } finally {
    d.dispose();
  }
});
