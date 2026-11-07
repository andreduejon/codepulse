import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createThemeState, ThemeContext } from "../../context/theme";
import { SnykLegend } from "./tab-shared";
import { VULNERABILITY_LEGEND } from "./vulnerabilities-model";

test("the legend wraps whole items instead of clipping them in a narrow panel", async () => {
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={40} flexDirection="column">
          <SnykLegend items={VULNERABILITY_LEGEND} />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 40, height: 4 },
  );
  try {
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    expect(lines[0]).toMatch(/● upgrade {2}● override {2}● no fix\s*$/);
    expect(lines[1]).toMatch(/! mature exploit\s*$/);
  } finally {
    setup.renderer.destroy();
  }
});
