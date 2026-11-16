/**
 * Test preload: every test run gets its own home, so no test can read or write the real codepulse config or cache
 * (`~/.config/codepulse`, `~/.cache/codepulse`, or `%APPDATA%` and `%LOCALAPPDATA%` on Windows). Bun reads `HOME`
 * once at startup, so `homedir()` itself is replaced.
 */
import { afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

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
afterAll(async () => {
  // Windows can't remove a file that is open: close the provider cache's database in that home first. Imported here,
  // after the mocks, so its default folder is the test home.
  const { closeProviderCaches } = await import("../src/providers/shared/sha-sqlite-cache");
  closeProviderCaches();
  rmSync(home, { recursive: true, force: true });
});
