import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../context/theme";
import SetupScreen from "./setup-screen";

test("welcome hints hover text-only, ignore right-click, and share callbacks with Enter and Q", async () => {
  const theme = createThemeState();
  const onComplete = mock(() => {});
  const onQuit = mock(() => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <SetupScreen repoPath="/repo" onComplete={onComplete} onQuit={onQuit} />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 40, useMouse: true, enableMouseMovement: true },
  );
  try {
    await setup.flush();
    for (const [label, action, other] of [
      ["continue", onComplete, onQuit],
      ["quit", onQuit, onComplete],
    ] as const) {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex(line => line.includes(label));
      expect(y).toBeGreaterThanOrEqual(0);
      const x = lines[y].indexOf(label) + 1;
      const span = () => setup.captureSpans().lines[y]?.spans.find(s => s.text.includes(label));
      const before = span();
      expect(before?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
      await setup.mockMouse.moveTo(x, y);
      await setup.flush();
      expect(span()?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
      expect(span()?.bg).toEqual(before?.bg);
      expect(action).not.toHaveBeenCalled();
      const otherCount = other.mock.calls.length;
      await setup.mockMouse.click(x, y, MouseButtons.RIGHT);
      await setup.flush();
      expect(action).not.toHaveBeenCalled();
      expect(other).toHaveBeenCalledTimes(otherCount);
      await setup.mockMouse.moveTo(0, 0);
      await setup.flush();
      expect(span()?.fg).toEqual(before?.fg);
      await setup.mockMouse.click(x, y);
      await setup.flush();
      expect(action).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(otherCount);
      expect(setup.renderer.isDestroyed).toBe(false);
    }
    setup.mockInput.pressKey("RETURN");
    await setup.flush();
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onQuit).toHaveBeenCalledTimes(1);
    setup.mockInput.pressKey("Q");
    await setup.flush();
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onQuit).toHaveBeenCalledTimes(2);
    expect(setup.renderer.isDestroyed).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});
