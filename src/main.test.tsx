import { expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import * as config from "./config";
import { startupProps } from "./main";
import * as cacheManagement from "./providers/shared/cache-management";
import * as themeFile from "./theme-file";

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
