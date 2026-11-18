import { expect, test } from "bun:test";
import { join } from "node:path";
import { getRepoRoot } from "./repo";
import { runGit } from "./repo-git";

const missing = join(import.meta.dir, "no-such-folder-for-codepulse");

test("Git in a folder that does not exist fails like a Git error instead of throwing", async () => {
  const result = await runGit(missing, ["rev-parse", "--show-toplevel"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("no-such-folder-for-codepulse");
});

test("`codepulse xyz` with no folder xyz: no repository root, so startup can say the folder does not exist", async () => {
  expect(await getRepoRoot(missing)).toBeNull();
});
