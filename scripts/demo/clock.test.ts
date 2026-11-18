import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED_NOW } from "./scenario";

const here = import.meta.dir;
const folder = mkdtempSync(join(tmpdir(), "codepulse-demo-clock-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** Runs `body` in a Bun with the headless demo's clock preloaded, as `--play` does, and returns what it printed. */
async function withDemoClock(body: string): Promise<unknown> {
  const script = join(folder, `script-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(
    script,
    `const { advanceDemoClock } = await import(${JSON.stringify(join(here, "clock.ts"))});\n${body}\n`,
  );
  const child = Bun.spawn([process.execPath, "--preload", join(here, "clock.ts"), script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(err);
  return JSON.parse(out);
}

test("the headless clock stands still while the play runs, so a slow run prints the same ages", async () => {
  const seen = await withDemoClock(`
    const first = Date.now();
    const started = performance.now();
    await Bun.sleep(120);
    console.log(JSON.stringify({ first, later: Date.now(), made: new Date().getTime(), elapsed: performance.now() - started }));
  `);
  expect(seen).toMatchObject({ first: FIXED_NOW, later: FIXED_NOW, made: FIXED_NOW });
  // Timers and elapsed time still run: only the wall clock stands still.
  expect((seen as { elapsed: number }).elapsed).toBeGreaterThanOrEqual(100);
});

test("a sleep step moves the headless clock on by exactly its time", async () => {
  const seen = await withDemoClock(`
    advanceDemoClock(90_000);
    console.log(JSON.stringify({ now: Date.now(), text: new Date().toISOString() }));
  `);
  expect(seen).toEqual({ now: FIXED_NOW + 90_000, text: new Date(FIXED_NOW + 90_000).toISOString() });
});
