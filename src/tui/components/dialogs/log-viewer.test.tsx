import { expect, test } from "bun:test";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../../context/theme";
import { LogViewer } from "./log-viewer";

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
