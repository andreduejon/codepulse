import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import App from "./app";
import { MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import type { StartupMode } from "./main";

test("startup selector and fatal errors respect minimum dimensions and recover after resizing", async () => {
  const modes: (Extract<StartupMode, { kind: "selector" | "error" }> & { message: string })[] = [
    { kind: "selector", message: "Doesn't look like a git repo", knownRepos: [] },
    { kind: "error", message: "Git is not installed or not on PATH." },
  ];
  for (const startupMode of modes) {
    const setup = await testRender(() => <App repoPath="/not-a-repo" startupMode={startupMode} />, {
      width: MIN_TERMINAL_WIDTH - 1,
      height: MIN_TERMINAL_HEIGHT,
    });
    try {
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Terminal too small");
      expect(setup.captureCharFrame()).not.toContain(startupMode.message);
      setup.resize(MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain(startupMode.message);
      expect(setup.captureCharFrame()).not.toContain("Terminal too small");
      setup.resize(MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT - 1);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Terminal too small");
    } finally {
      setup.renderer.destroy();
    }
  }
});
