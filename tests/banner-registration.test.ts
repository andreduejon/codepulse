import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * A provider's messages are known as soon as the provider is: its definition carries them. Checked in a fresh process,
 * without the test preload that loads every provider, so nothing else has registered them first.
 */
test("a provider's messages show as they are once only its definition is loaded", async () => {
  const root = join(import.meta.dir, "..");
  const script = `
    const { isBanner, displayBanner } = await import("./src/core/banner");
    const { jenkinsProvider } = await import("./src/core/jenkins/definition");
    const message = jenkinsProvider.messages.authFailed;
    console.log(JSON.stringify({ known: isBanner(message), shown: displayBanner(message, "fallback") === message }));
  `;
  const child = Bun.spawn(["bun", "-e", script], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(output.trim())).toEqual({ known: true, shown: true });
});
