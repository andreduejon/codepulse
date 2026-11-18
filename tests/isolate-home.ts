/**
 * Test preload: every test run gets its own home, so no test can read or write the real codepulse config or cache
 * (`~/.config/codepulse`, `~/.cache/codepulse`, or `%APPDATA%` and `%LOCALAPPDATA%` on Windows). Bun reads `HOME`
 * once at startup, so `homedir()` itself is replaced.
 */
import { afterAll, mock, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

// A test cut at its time limit keeps running beside the next one: its renderer and the next test's overlap, and its
// errors land there (OpenTUI's WrongContext, counts read from the wrong screen). The UI tests mount large screens, which
// on a loaded machine can take over Bun's default 5 s: give them room, so only a test that really hangs is cut.
setDefaultTimeout(30_000);

const realHome = os.homedir();
const home = mkdtempSync(join(os.tmpdir(), "codepulse-test-home-"));
process.env.CODEPULSE_TEST_REAL_HOME = realHome;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = join(home, "AppData", "Roaming");
process.env.LOCALAPPDATA = join(home, "AppData", "Local");
const isolated = { ...os, homedir: () => home };
mock.module("node:os", () => ({ ...isolated, default: isolated }));
mock.module("os", () => ({ ...isolated, default: isolated }));
// The ports a component falls back to when a test renders it without them: the terminal app's, in this home. Loaded
// after the mocks, like the cache below, so their default folders are the test home.
const { terminalPorts } = await import("../src/ports");
const { builtInProviders, modulesOf } = await import("../src/providers");
const { setDefaultPorts } = await import("../src/tui/context/ports");
const { setDefaultProviderModules } = await import("../src/tui/context/provider-modules");
setDefaultPorts(terminalPorts());
setDefaultProviderModules(modulesOf(builtInProviders));
afterAll(async () => {
  // Windows can't remove a file that is open: close the provider cache's database in that home first. Imported here,
  // after the mocks, so its default folder is the test home.
  const { closeProviderCaches } = await import("../src/adapters/cache/sha-sqlite-cache");
  closeProviderCaches();
  rmSync(home, { recursive: true, force: true });
});
