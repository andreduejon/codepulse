/**
 * The headless demo (`bun run demo --play "…"`): the real app in OpenTUI's test renderer, played step by step. Each
 * `shot` prints the screen as text. A step that fails prints why and the screen at that moment, and exits with 1.
 *
 * The app boots through the same `startupProps` as `codepulse` itself, with the demo's fake servers preloaded.
 */
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import App from "../../src/app";
import { startupProps } from "../../src/main";
import { advancePhase } from "./phase";
import { loadDemoState, type PlayConfig } from "./scenario";
import { parsePlay, type Step, type Target } from "./steps";

/** How long `wait:` and `gone:` wait, and how long a screen may keep changing after a step before the next one. */
const WAIT_MS = 30_000;
const SETTLE_MS = 5_000;
const FIRST_SETTLE_MS = 20_000;
/** Between repeats of a key (`down*5`), a little longer than the app's navigation throttle. */
const KEY_REPEAT_MS = 40;

class StepFailure extends Error {}

export async function play(config: PlayConfig): Promise<number> {
  const steps = parsePlay(config.steps);
  const latency = loadDemoState().latency;
  // The screen counts as settled once it has not changed for this long: longer than one fake request.
  const quietMs = Math.max(300, latency * 2 + 100);
  // A test renderer has no terminal to name (the app's tests stub this too).
  CliRenderer.prototype.setTerminalTitle = () => {};
  const props = await startupProps(["bun", "codepulse", config.repoPath]);
  const setup = await testRender(() => <App {...props} />, {
    width: config.width,
    height: config.height,
  });
  let size = { width: config.width, height: config.height };
  let shots = 0;

  const screen = () => setup.captureCharFrame();
  const lines = () =>
    screen()
      .split("\n")
      .map(line => line.trimEnd());
  const print = (title: string, body: string[]) =>
    process.stdout.write(`=== ${title} (${size.width}x${size.height}) ===\n${body.join("\n")}\n`);

  /** Renders until the screen stops changing, or `limit` passes (a spinner never stops). */
  const settle = async (limit = SETTLE_MS) => {
    const deadline = performance.now() + limit;
    let last = "";
    let since = performance.now();
    while (performance.now() < deadline && !setup.renderer.isDestroyed) {
      await Bun.sleep(25);
      await setup.renderOnce();
      const current = screen();
      if (current !== last) {
        last = current;
        since = performance.now();
      } else if (performance.now() - since >= quietMs) return;
    }
  };

  /** Renders until `done` holds, or fails after WAIT_MS. */
  const until = async (done: () => boolean, failure: string) => {
    const deadline = performance.now() + WAIT_MS;
    while (!done()) {
      if (performance.now() > deadline || setup.renderer.isDestroyed) throw new StepFailure(failure);
      await Bun.sleep(50);
      await setup.renderOnce();
    }
    await settle();
  };

  /** The cell to point the mouse at: the middle of the nth place a text shows, or the cell itself. */
  const locate = (target: Target): { x: number; y: number } => {
    if (target.kind === "cell") return { x: target.x, y: target.y };
    let seen = 0;
    const rows = lines();
    for (let y = 0; y < rows.length; y++) {
      let from = 0;
      for (;;) {
        const index = rows[y].indexOf(target.text, from);
        if (index < 0) break;
        if (++seen === target.nth)
          return { x: Bun.stringWidth(rows[y].slice(0, index)) + Math.floor(Bun.stringWidth(target.text) / 2), y };
        from = index + 1;
      }
    }
    throw new StepFailure(
      `"${target.text}"${target.nth > 1 ? ` #${target.nth}` : ""} is not on screen (seen ${seen} time${seen === 1 ? "" : "s"})`,
    );
  };

  const run = async (step: Step) => {
    switch (step.kind) {
      case "key":
        for (let i = 0; i < step.repeat; i++) {
          // Like a held key: the app drops navigation keys that come faster than a key repeat.
          if (i > 0) {
            await Bun.sleep(KEY_REPEAT_MS);
            await setup.renderOnce();
          }
          setup.mockInput.pressKey(step.key, step.modifiers);
        }
        return settle();
      case "type":
        // One key per character, not per UTF-16 unit, so an emoji arrives whole.
        await setup.mockInput.pressKeys([...step.text]);
        return settle();
      case "wait":
        return until(
          () => screen().includes(step.text),
          `"${step.text}" did not show within ${WAIT_MS / 1000} seconds`,
        );
      case "gone":
        return until(() => !screen().includes(step.text), `"${step.text}" did not go within ${WAIT_MS / 1000} seconds`);
      case "expect":
        if (!screen().includes(step.text)) throw new StepFailure(`"${step.text}" is not on screen`);
        return;
      case "absent":
        if (screen().includes(step.text)) throw new StepFailure(`"${step.text}" is on screen`);
        return;
      case "shot":
        shots++;
        print(`shot ${shots}${step.name ? `: ${step.name}` : ""}`, lines());
        return;
      case "size":
        size = { width: step.width, height: step.height };
        setup.resize(step.width, step.height);
        return settle();
      case "advance":
        if (!advancePhase()) throw new StepFailure("the world is already at its last phase");
        return settle();
      case "click": {
        const { x, y } = locate(step.target);
        await setup.mockMouse.click(x, y);
        return settle();
      }
      case "hover": {
        const { x, y } = locate(step.target);
        await setup.mockMouse.moveTo(x, y);
        return settle();
      }
      case "scroll": {
        const { x, y } = step.target
          ? locate(step.target)
          : { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) };
        for (let i = 0; i < step.repeat; i++) await setup.mockMouse.scroll(x, y, step.direction);
        return settle();
      }
      case "sleep": {
        // In short naps, so a stopped app (a signal) ends the play at once rather than after the whole sleep.
        const end = performance.now() + step.ms;
        while (performance.now() < end && !setup.renderer.isDestroyed)
          await Bun.sleep(Math.min(50, end - performance.now()));
        return settle();
      }
    }
  };

  let code = 0;
  await settle(FIRST_SETTLE_MS);
  for (const [index, { source, step }] of steps.entries()) {
    if (setup.renderer.isDestroyed) {
      print(`failed at step ${index + 1} (${source}): the app quit before it`, []);
      code = 1;
      break;
    }
    try {
      await run(step);
    } catch (error) {
      if (!(error instanceof StepFailure)) throw error;
      print(`failed at step ${index + 1} (${source}): ${error.message}`, lines());
      code = 1;
      break;
    }
  }
  if (code === 0 && shots === 0 && !setup.renderer.isDestroyed) print("end", lines());
  if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  return code;
}
