#!/usr/bin/env bun
import "@opentui/solid/preload";

const { main } = await import("./main");
main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
