/**
 * `bun run demo`: codepulse on throwaway repositories with made-up GitHub Actions, Jenkins, OpenShift and Snyk data,
 * so every row, label and message can be looked at without a real server. See docs/demo.md.
 *
 * Interactive by default; `--play "STEPS"` runs it headless and prints the screens (player.tsx). Either way the app
 * runs in its own process with the fake servers preloaded (fake-fetch.ts), inside a fresh folder (world.ts) that is
 * removed afterwards unless `--keep` is given.
 */
import { rmSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { DEMO_HELP, DemoOptionError, parseDemoOptions } from "./options";
import { FIXED_NOW, PLAY_ENV, type PlayConfig } from "./scenario";
import { PlayError, parsePlay } from "./steps";
import { buildWorld } from "./world";

const here = import.meta.dir;
const repoRoot = join(here, "..", "..");

let options: ReturnType<typeof parseDemoOptions>;
try {
  options = parseDemoOptions(process.argv.slice(2));
  if (options.play !== null) parsePlay(options.play);
} catch (error) {
  if (!(error instanceof DemoOptionError || error instanceof PlayError)) throw error;
  console.error(`${error.message}\n`);
  console.error(DEMO_HELP);
  process.exit(2);
}
if (options.help) {
  console.log(DEMO_HELP);
  process.exit(0);
}

const headless = options.play !== null;

// A signal stops the app, and the launcher stays to clean up after it. Listening starts before the folder is built,
// so a signal in the middle of building still removes it: building runs Git synchronously, and the signal is handled
// once it is done.
const STOP_GRACE_MS = 5000;
let app: ReturnType<typeof Bun.spawn> | null = null;
let stoppedBy: NodeJS.Signals | null = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    stoppedBy ??= signal;
    if (!app) return;
    app.kill(signal);
    // An app that has not stopped a few seconds later is stopped hard.
    setTimeout(() => app?.kill("SIGKILL"), STOP_GRACE_MS).unref();
  });
/** The exit code of a run stopped by a signal, like a shell's: 128 and the signal's number. */
const stoppedCode = (signal: NodeJS.Signals) => 128 + (constants.signals[signal] ?? 0);

// Headless: a fixed clock for the commits and the app, so a play prints the same screens every run.
let world: ReturnType<typeof buildWorld>;
try {
  world = buildWorld(options, headless ? FIXED_NOW : Date.now());
} catch (error) {
  // A signal also stops the Git that was building, which fails the build: that is the signal's doing.
  await Bun.sleep(0);
  if (stoppedBy) process.exit(stoppedCode(stoppedBy));
  throw error;
}

let exitCode = 1;
try {
  // A signal that came while building is handled here, before the app starts.
  await Bun.sleep(0);
  if (!stoppedBy) {
    const preloads = [...(headless ? [join(here, "clock.ts")] : []), join(here, "fake-fetch.ts")];
    const entry = headless ? join(here, "play.ts") : join(repoRoot, "src", "index.tsx");
    const env = { ...world.env };
    if (options.play !== null) {
      const config: PlayConfig = { steps: options.play, ...options.size, repoPath: world.repoPath };
      env[PLAY_ENV] = JSON.stringify(config);
    }
    app = Bun.spawn([process.execPath, ...preloads.flatMap(path => ["--preload", path]), entry, world.repoPath], {
      cwd: repoRoot,
      stdio: ["inherit", "inherit", "inherit"],
      env,
    });
    exitCode = await app.exited;
  }
} finally {
  if (options.keep) console.error(`Demo folder kept: ${world.root}`);
  else rmSync(world.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(stoppedBy ? stoppedCode(stoppedBy) : exitCode);
