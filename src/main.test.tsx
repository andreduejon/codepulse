import { expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import * as cacheManagement from "./adapters/cache/cache-management";
import { providerCacheStore } from "./adapters/cache/cache-store";
import * as config from "./adapters/settings/config";
import * as themeFile from "./adapters/settings/theme-file";
import { startupProps } from "./main";

test("`codepulse xyz` without a folder xyz opens the project selector saying so, instead of a fatal error", async () => {
  const missing = join(import.meta.dir, "no-such-folder-for-codepulse");
  const spies = [
    spyOn(cacheManagement, "cleanupInactiveProviderCaches").mockReturnValue(0),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([]),
    spyOn(themeFile, "readCustomThemesFile").mockReturnValue(null),
  ];
  try {
    const props = await startupProps(["bun", "codepulse", missing]);
    expect(props.startupMode).toEqual({
      kind: "selector",
      message: "Hmm, that directory doesn't exist",
      messagePath: missing,
      knownRepos: [],
    });
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

test("startup cleans the cache of the ports it is given, not the process's default cache", async () => {
  const missing = join(import.meta.dir, "no-such-folder-for-codepulse");
  const own = providerCacheStore(join(import.meta.dir, "no-such-cache-for-codepulse"));
  const cleaned = spyOn(own, "cleanupInactive").mockReturnValue(0);
  const spies = [
    spyOn(cacheManagement, "cleanupInactiveProviderCaches").mockReturnValue(0),
    spyOn(config, "loadConfig").mockReturnValue({ config: {}, warnings: [] }),
    spyOn(config, "getKnownRepoInfos").mockReturnValue([]),
    spyOn(themeFile, "readCustomThemesFile").mockReturnValue(null),
  ];
  try {
    await startupProps(["bun", "codepulse", missing], { cacheStore: own });
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(spies[0]).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
