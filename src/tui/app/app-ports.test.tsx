/** The app's ports reach every screen, the startup ones too: a screen never falls back to another app's. */
import { expect, mock, spyOn, test } from "bun:test";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import * as configWrite from "../../adapters/settings/config-write";
import { fileSettings } from "../../adapters/settings/settings-file";
import type { SettingsPort } from "../../core/settings/port";
import App from "./app";

test("the startup project selector forgets a project in the settings the app was given", async () => {
  const remove = mock(() => true);
  const settings: SettingsPort = { ...fileSettings([]), remove };
  const registered = spyOn(configWrite, "removeRepoConfig").mockReturnValue(true);
  const setup = await testRender(
    () => (
      <App
        repoPath="/repo/missing"
        settings={settings}
        startupMode={{ kind: "selector", knownRepos: [{ path: "/repo/alpha", appName: "Alpha" }] }}
      />
    ),
    { width: 110, height: 40, useMouse: true, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("f forget"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(lines[y].indexOf("f forget") + 1, y, MouseButtons.LEFT);
    await setup.flush();
    expect(remove).toHaveBeenCalledWith("/repo/alpha");
    expect(registered).not.toHaveBeenCalled();
  } finally {
    registered.mockRestore();
    setup.renderer.destroy();
  }
});
