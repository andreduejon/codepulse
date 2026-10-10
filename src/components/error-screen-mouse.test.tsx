import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../context/theme";
import ErrorScreen from "./error-screen";

test("error screen Quit hover is text-only; only left-click quits", async () => {
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <ErrorScreen error="Terminal too small" />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 30, useMouse: true, enableMouseMovement: true },
  );
  try {
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("q quit"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = lines[y].indexOf("q quit") + 2;
    await setup.mockMouse.moveTo(x, y);
    await setup.flush();
    const span = setup.captureSpans().lines[y]?.spans.find(span => span.text.includes("quit"));
    expect(span?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
    expect(span?.bg).not.toEqual(RGBA.fromHex(theme.theme().backgroundElementActive));
    await setup.mockMouse.click(x, y, MouseButtons.RIGHT);
    expect(setup.renderer.isDestroyed).toBe(false);
    await setup.mockMouse.click(x, y);
    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
