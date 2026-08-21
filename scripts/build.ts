import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  outdir: "./dist",
  plugins: [solidPlugin],
  packages: "external",
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
