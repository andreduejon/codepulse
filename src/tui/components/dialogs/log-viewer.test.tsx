import { expect, test } from "bun:test";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../../context/theme";
import { LogViewer, wrappedRows } from "./log-viewer";

const count = (node: Renderable): number => 1 + node.getChildren().reduce((sum, child) => sum + count(child), 0);

test("a wrapped log mounts only the lines near the screen, each as tall as its width needs", async () => {
  const lines = Array.from({ length: 5_000 }, (_, i) => ({
    text: `line ${i}: ${"a typical build output message ".repeat(8)}`,
    lineNo: i + 1,
  }));
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <LogViewer
          title={() => [{ text: "Wrap" }]}
          lines={() => lines}
          state={() => null}
          searchPlaceholder={() => "Search..."}
          onClose={() => {}}
        />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.renderOnce();
    const unwrapped = count(setup.renderer.root);
    setup.mockInput.pressKey("w");
    await setup.renderOnce();
    await setup.renderOnce();
    expect(count(setup.renderer.root)).toBeLessThan(unwrapped * 2);
    // Every line takes three or four rows at this width: its first rows show, wrapped by character.
    const frame = setup.captureCharFrame();
    expect(frame).toContain("1  line 0: a typical build output message");
    expect(frame).not.toContain("  6  line 5:");
  } finally {
    setup.renderer.destroy();
  }
});

test("a wrapped line's rows: a wide character that doesn't fit at a row's end starts the next row", () => {
  expect(wrappedRows("", 10)).toBe(1);
  expect(wrappedRows("a".repeat(20), 10)).toBe(2);
  expect(wrappedRows("a".repeat(21), 10)).toBe(3);
  // One two-column character a row at three columns: three rows, where six columns alone would say two.
  expect(wrappedRows("界界界", 3)).toBe(3);
  expect(wrappedRows(`${"a".repeat(9)}界`, 10)).toBe(2);
  // As the renderer draws them: a tab takes two columns, a joined emoji is one two-column character.
  expect(wrappedRows("a\tb", 3)).toBe(2);
  expect(wrappedRows("👩‍💻👩‍💻👩‍💻", 4)).toBe(2);
  expect(wrappedRows("界", 1)).toBe(1);
});

test("wrapped wide lines: G reaches the last line and a search shows its hit", async () => {
  const lines = Array.from({ length: 500 }, (_, i) => ({
    text: `${"界".repeat(71)}${String(i).padStart(6, "0")}X`,
    lineNo: i + 1,
  }));
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <LogViewer
          title={() => [{ text: "Wide" }]}
          lines={() => lines}
          state={() => null}
          searchPlaceholder={() => "Search..."}
          onClose={() => {}}
        />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 30 },
  );
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(0);
      await setup.renderOnce();
    }
  };
  try {
    await settle();
    setup.mockInput.pressKey("w");
    await settle();
    setup.mockInput.pressKey("G");
    await settle();
    expect(setup.captureCharFrame()).toContain("000499X");
    setup.mockInput.pressKey("/");
    await settle();
    await setup.mockInput.typeText("000400");
    await settle();
    expect(setup.captureCharFrame()).toContain("000400X");
  } finally {
    setup.renderer.destroy();
  }
});
