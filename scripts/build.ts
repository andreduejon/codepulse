import { chmodSync, rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

rmSync("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  target: "bun",
  outdir: "./dist",
  plugins: [solidPlugin],
  packages: "external",
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

const cli = `#!/usr/bin/env bun
import "@opentui/solid/preload";
const { main } = await import("./main.js");
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
`;

await Bun.write("./dist/cli.js", cli);
chmodSync("./dist/cli.js", 0o755);
