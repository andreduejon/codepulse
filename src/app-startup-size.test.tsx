import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import App from "./app";
import { MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { type CustomTheme, themes } from "./context/theme";
import type { StartupMode } from "./main";

test("startup error uses the selected custom theme passed to App", async () => {
  const custom: CustomTheme = {
    id: "startup-custom",
    base: "nord",
    overrides: ["background"],
    theme: { ...themes.nord, name: "Startup Custom", background: "#123456" },
  };
  const message = "Custom theme startup error";
  const setup = await testRender(
    () => (
      <App
        repoPath="/not-a-repo"
        startupMode={{ kind: "error", message }}
        themeName={custom.id}
        customThemes={[custom]}
      />
    ),
    { width: 100, height: 40 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain(message);
    const span = setup
      .captureSpans()
      .lines.flatMap(line => line.spans)
      .find(span => span.text.includes(message));
    expect(span?.bg).toEqual(RGBA.fromHex(custom.theme.background));
  } finally {
    await setup.dispose();
  }
});

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
      await setup.dispose();
    }
  }
});
