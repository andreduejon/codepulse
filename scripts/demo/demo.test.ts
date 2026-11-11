/**
 * The demo end to end: `bun run demo --play` on every OS the CI runs. It plays, prints the same screens every run,
 * and leaves nothing behind outside its own folder (which it removes).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseDemoOptions } from "./options";
import { buildWorld, installFakeCli } from "./world";

const repoRoot = join(import.meta.dir, "..", "..");
const sandbox = mkdtempSync(join(tmpdir(), "codepulse-demo-test-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** A home and temp folder of the sandbox's own, standing in for the user's. */
function userEnv(name: string) {
  const home = join(sandbox, name, "home");
  const temp = join(sandbox, name, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temp, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    // Bun's own cache would land in the stand-in home; it is not the demo's to clean up.
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  });
  return { home, temp, env };
}

function spawnDemo(args: string[], env: Record<string, string>) {
  return Bun.spawn([process.execPath, join("scripts", "demo", "run.ts"), ...args], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function demo(args: string[], env: Record<string, string>) {
  const child = spawnDemo(args, env);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

/** Every file and folder under `root`, relative to it. */
function contents(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map(entry =>
    relative(root, join(entry.parentPath, entry.name)),
  );
}

const PLAY = [
  "j j enter",
  'tab wait:"CI #812" expect:"attempt 2" shot:actions',
  "tab wait:Unit expect:aborted shot:jenkins",
  "esc g tab enter wait:pull9 advance sleep:400 shot:openshift",
].join("\n");

describe("bun run demo --play", () => {
  test(
    "plays the steps, prints the same screens every run, and writes nothing outside its folder",
    async () => {
      const user = userEnv("same");
      const first = await demo(["--play", PLAY], user.env);
      expect(first.stderr).not.toContain("error");
      expect(first.code).toBe(0);
      const shots = first.stdout.match(/^=== shot \d+: \w+ \(160x45\) ===$/gm);
      expect(shots).toEqual([
        "=== shot 1: actions (160x45) ===",
        "=== shot 2: jenkins (160x45) ===",
        "=== shot 3: openshift (160x45) ===",
      ]);
      // The shop-dev rollout fails once the world moves on: a watch event, no reload.
      const openshift = first.stdout.slice(first.stdout.indexOf("=== shot 3"));
      expect(openshift).toMatch(/shop-api-7d9f8-pull9\s+✗/);

      const second = await demo(["--play", PLAY], user.env);
      expect(second.code).toBe(0);
      expect(second.stdout).toBe(first.stdout);

      expect(contents(user.home)).toEqual([]);
      expect(contents(user.temp)).toEqual([]);
    },
    { timeout: 180_000 },
  );

  test(
    "a step that fails says which and why, prints the screen, and exits with 1",
    async () => {
      const user = userEnv("fail");
      const result = await demo(["--github", "off", "--play", "wait:Jenkins absent:Jenkins shot"], user.env);
      expect(result.code).toBe(1);
      expect(result.stdout).toMatch(
        /^=== failed at step 2 \(absent:Jenkins\): "Jenkins" is on screen \(160x45\) ===$/m,
      );
      expect(result.stdout).not.toContain("=== shot");
      expect(result.stdout).toContain("Graph");
      expect(contents(user.temp)).toEqual([]);
    },
    { timeout: 120_000 },
  );

  test(
    "a signal while the world is built still removes the folder, and the demo exits as stopped",
    async () => {
      const user = userEnv("signal-build");
      const child = spawnDemo(["--play", "shot"], user.env);
      // Stop it as soon as its folder exists: in the middle of building the repositories.
      for (let i = 0; i < 500 && contents(user.temp).length === 0; i++) await Bun.sleep(10);
      expect(contents(user.temp).length).toBeGreaterThan(0);
      child.kill("SIGTERM");
      expect(await child.exited).toBe(143);
      expect(contents(user.temp)).toEqual([]);
    },
    { timeout: 120_000 },
  );

  test(
    "a signal stops a play at once, also in the middle of a sleep, and the folder goes",
    async () => {
      const user = userEnv("signal-sleep");
      const child = spawnDemo(["--play", "shot sleep:60000 shot"], user.env);
      const reader = child.stdout.getReader();
      let output = "";
      while (!output.includes("=== shot 1")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
      }
      reader.releaseLock();
      const stoppedAt = performance.now();
      child.kill("SIGTERM");
      expect(await child.exited).toBe(143);
      expect(performance.now() - stoppedAt).toBeLessThan(10_000);
      expect(contents(user.temp)).toEqual([]);
    },
    { timeout: 120_000 },
  );

  test(
    "a followed log prints the same lines every run",
    async () => {
      const user = userEnv("follow");
      const play = "g tab*3 enter wait:pull9 click:shop-api-7d9f8-r2m4p shot";
      const first = await demo(["--play", play], user.env);
      expect(first.code).toBe(0);
      expect(first.stdout).toMatch(/RequestLog/);
      const second = await demo(["--play", play], user.env);
      expect(second.stdout).toBe(first.stdout);
    },
    { timeout: 180_000 },
  );

  test(
    "typed text arrives whole, an emoji too",
    async () => {
      const user = userEnv("emoji");
      const result = await demo(["--play", "/ type:🚀 expect:🚀"], user.env);
      expect(result.stdout).not.toContain("=== failed");
      expect(result.code).toBe(0);
    },
    { timeout: 120_000 },
  );

  test("a wrong option or step stops before anything is built", async () => {
    const user = userEnv("wrong");
    const result = await demo(["--play", "details"], user.env);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown step details. To type text, write type:details.");
    expect(contents(user.temp)).toEqual([]);
  });
});

test(
  "the compiled fake CLIs (the Windows way) answer as snyk and npm",
  async () => {
    const bin = join(sandbox, "compiled-bin");
    mkdirSync(bin, { recursive: true });
    installFakeCli(bin, ["snyk", "npm"], true);
    const extension = process.platform === "win32" ? ".exe" : "";
    const run = (name: string, args: string[]) => {
      const result = Bun.spawnSync([join(bin, `${name}${extension}`), ...args]);
      return { code: result.exitCode, stdout: result.stdout.toString().trim() };
    };
    expect(run("snyk", ["--version"])).toEqual({ code: 0, stdout: "1.1300.0 (demo)" });
    expect(run("npm", ["view", "minimist", "versions", "--json"])).toEqual({
      code: 0,
      stdout: JSON.stringify(["1.2.5", "1.2.6", "1.2.7", "1.2.8"]),
    });
  },
  { timeout: 120_000 },
);

test(
  "--live moves the world on by itself without keeping the app running once it quits",
  async () => {
    const world = buildWorld(parseDemoOptions(["--live", "60"]), Date.now());
    try {
      const started = performance.now();
      const app = Bun.spawn(
        [process.execPath, "--preload", join(import.meta.dir, "fake-fetch.ts"), "-e", "console.log('quit')"],
        { cwd: repoRoot, env: world.env, stdout: "pipe", stderr: "pipe" },
      );
      expect(await app.exited).toBe(0);
      expect(performance.now() - started).toBeLessThan(10_000);
    } finally {
      rmSync(world.root, { recursive: true, force: true });
    }
  },
  { timeout: 120_000 },
);
