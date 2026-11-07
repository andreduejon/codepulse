import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
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

test("the dismiss cross closes the banner on a left click only", async () => {
  const theme = createThemeState();
  const onDismiss = mock(() => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <MessageBox kind="error" message="Partial scan." onDismiss={onDismiss} />
      </ThemeContext.Provider>
    ),
    { width: 40, height: 6 },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("✕"));
    const x = lines[y].indexOf("✕");
    expect(lines[y]).toContain("Partial scan.");
    await setup.mockMouse.click(x, y, MouseButtons.RIGHT);
    expect(onDismiss).not.toHaveBeenCalled();
    await setup.mockMouse.click(x, y);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("banners without a dismiss handler show no cross", async () => {
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <MessageBox kind="error" message="Partial scan." />
      </ThemeContext.Provider>
    ),
    { width: 40, height: 6 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("✕");
  } finally {
    setup.renderer.destroy();
  }
});

test("a source shows muted after the headline; later sentences become muted detail", async () => {
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <MessageBox kind="error" source="Snyk" message="Partial scan. Kept last complete snapshot." />
      </ThemeContext.Provider>
    ),
    { width: 60, height: 6 },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    expect(lines[1]).toContain("     Partial scan · Snyk");
    expect(lines[2]).toContain("     Kept last complete snapshot.");
    const spans = setup.captureSpans().lines[1].spans;
    const span = (text: string) => spans.find(candidate => candidate.text.includes(text));
    expect(span("Snyk")?.fg).toEqual(RGBA.fromHex(theme.theme().foregroundMuted));
    expect(span("Partial scan")?.fg).toEqual(RGBA.fromHex(theme.theme().foreground));
  } finally {
    setup.renderer.destroy();
  }
});
