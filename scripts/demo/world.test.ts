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

test("the app gets none of the user's credentials, proxies, agents or folders outside the demo", () => {
  const hostile: Record<string, string> = {
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    KUBECONFIG: "/home/someone/.kube/config",
    GH_TOKEN: "ghp_real",
    HTTPS_PROXY: "http://proxy:3128",
    https_proxy: "http://proxy:3128",
    XDG_DATA_HOME: "/home/someone/.local/share",
    XDG_STATE_HOME: "/home/someone/.local/state",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/home/someone/.bun-cache",
    CODEPULSE_CONFIG: "/home/someone/.config/codepulse/config.json",
    // OpenTUI's input log and captures write files wherever these point.
    OTUI_STDIN_LOG: "/home/someone/input.log",
    OTUI_DUMP_CAPTURES: "1",
  };
  const saved = Object.fromEntries(Object.keys(hostile).map(key => [key, process.env[key]]));
  Object.assign(process.env, hostile);
  let other: ReturnType<typeof buildWorld> | undefined;
  try {
    other = buildWorld(parseDemoOptions(["--play", "shot"]), FIXED_NOW);
    const env = other.env;
    for (const key of ["SSH_AUTH_SOCK", "KUBECONFIG", "GH_TOKEN", "HTTPS_PROXY", "https_proxy"])
      expect(env[key]).toBeUndefined();
    expect(env.BUN_RUNTIME_TRANSPILER_CACHE_PATH).toBeUndefined();
    expect(env.CODEPULSE_CONFIG).toBeUndefined();
    expect(env.OTUI_STDIN_LOG).toBeUndefined();
    expect(env.OTUI_DUMP_CAPTURES).toBeUndefined();
    for (const [key, value] of Object.entries(env).filter(([key]) => key.startsWith("XDG_")))
      expect(`${key}=${value}`).toStartWith(`${key}=${other.root}`);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (other) rmSync(other.root, { recursive: true, force: true });
  }
});
