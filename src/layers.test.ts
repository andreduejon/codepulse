/**
 * The layers, by folder: every relative import of a module (tests aside) resolves into a layer it may use.
 * - src/core: core only. The app's logic and its ports.
 * - src/adapters: core and adapters. They implement core's ports (Git, HTTP, caches, settings, the system).
 * - src/tui: core and tui. The terminal front end; it reaches the adapters only through the ports.
 * - the root (src/*.ts, src/cli): anything. It builds the adapters and hands them to the front end.
 * The linter refuses the same imports by folder name as they are written; this catches every other way across.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const src = resolve(import.meta.dir);
type Layer = "core" | "adapters" | "tui" | "root";
const MAY_USE: Record<Layer, readonly Layer[]> = {
  core: ["core"],
  adapters: ["core", "adapters"],
  tui: ["core", "tui"],
  root: ["core", "adapters", "tui", "root"],
};

const layerOf = (file: string): Layer => {
  const top = relative(src, file).split(/[\\/]/)[0];
  return top === "core" || top === "adapters" || top === "tui" ? top : "root";
};

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

test("each layer imports only the layers it may use", () => {
  const crossings: string[] = [];
  for (const file of modules(src)) {
    const from = layerOf(file);
    for (const match of readFileSync(file, "utf-8").matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
      const target = resolve(dirname(file), match[1]);
      if (relative(src, target).startsWith("..")) continue; // package.json and the like
      const to = layerOf(target);
      if (!MAY_USE[from].includes(to)) crossings.push(`${relative(src, file)} (${from}) → ${match[1]} (${to})`);
    }
  }
  expect(crossings).toEqual([]);
});
