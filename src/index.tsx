#!/usr/bin/env bun
import "@opentui/solid/preload";

process.title = "codepulse";

const { main } = await import("./main");
main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
