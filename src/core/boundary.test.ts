/**
 * src/core depends on nothing but itself and plain packages: every relative import of a core module (tests aside)
 * resolves inside src/core. The linter refuses the app's layers by name; this catches every other way out.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const core = resolve(import.meta.dir);

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("core imports only core", () => {
  const outside: string[] = [];
  for (const file of modules(core)) {
    for (const match of readFileSync(file, "utf-8").matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
      const target = resolve(dirname(file), match[1]);
      if (relative(core, target).startsWith("..")) outside.push(`${relative(core, file)} → ${match[1]}`);
    }
  }
  expect(outside).toEqual([]);
});
