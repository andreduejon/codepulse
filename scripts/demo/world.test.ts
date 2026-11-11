/**
 * The world the demo builds: what the app finds on its PATH and where what it hands the host ends up.
 */
import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDemoOptions } from "./options";
import { FIXED_NOW } from "./scenario";
import { buildWorld } from "./world";

const world = buildWorld(parseDemoOptions(["--play", "shot"]), FIXED_NOW);
afterAll(() => rmSync(world.root, { recursive: true, force: true }));

test("o and copy reach the demo's own browser and clipboard commands, which write to outside.log", () => {
  const PATH = world.env.PATH ?? world.env.Path ?? "";
  const commands =
    process.platform === "win32" ? ["powershell", "clip"] : ["open", "xdg-open", "pbcopy", "wl-copy", "xclip"];
  for (const command of commands) expect(dirname(Bun.which(command, { PATH }) ?? "")).toBe(join(world.root, "bin"));

  const run = (command: string, args: string[], stdin?: string) =>
    Bun.spawnSync([Bun.which(command, { PATH }) ?? command, ...args], {
      env: { ...world.env, CODEPULSE_OPEN_URL: args[0] ?? "" },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    }).exitCode;
  const opener = process.platform === "win32" ? "powershell" : "open";
  const copier = process.platform === "win32" ? "clip" : "pbcopy";
  expect(run(opener, ["https://github.com/demo/shop/actions/runs/9001"])).toBe(0);
  expect(run(copier, [], "a1b2c3d")).toBe(0);
  expect(readFileSync(join(world.root, "outside.log"), "utf8")).toBe(
    "browser https://github.com/demo/shop/actions/runs/9001\nclipboard a1b2c3d\n",
  );
});
