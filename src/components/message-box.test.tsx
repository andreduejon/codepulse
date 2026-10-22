import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../context/theme";
import MessageBox, { type UIMessageKind } from "./message-box";

test("banner border follows its kind: error, warning, info", async () => {
  const theme = createThemeState();
  for (const [kind, color] of [
    ["error", theme.theme().error],
    ["warning", theme.theme().warning],
    ["info", theme.theme().info],
  ] as [UIMessageKind, string][]) {
    const setup = await testRender(
      () => (
        <ThemeContext.Provider value={theme}>
          <MessageBox kind={kind} message={"Header\nDetail line"} />
        </ThemeContext.Provider>
      ),
      { width: 40, height: 6 },
    );
    try {
      await setup.renderOnce();
      const lines = setup.captureSpans().lines;
      const border = lines.find(line => line.spans.some(span => span.text.includes("Header")))?.spans[0];
      expect(border?.text.startsWith("│")).toBe(true);
      expect(border?.fg).toEqual(RGBA.fromHex(color));
      expect(setup.captureCharFrame()).toContain("Detail line");
    } finally {
      setup.renderer.destroy();
    }
  }
});
