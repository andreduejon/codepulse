import { chmodSync, rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

const supportedTargets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-arm64-musl",
  "bun-linux-x64",
  "bun-linux-x64-musl",
] as const;

type BuildTarget = (typeof supportedTargets)[number];

function getHostTarget(): BuildTarget {
  const target = `bun-${process.platform}-${process.arch}`;
  if (supportedTargets.includes(target as BuildTarget)) return target as BuildTarget;
  throw new Error(`Unsupported build host: ${process.platform}-${process.arch}`);
}

const target = process.env.CODEPULSE_BUILD_TARGET ?? getHostTarget();
if (!supportedTargets.includes(target as BuildTarget)) {
  throw new Error(`Unsupported build target: ${target}`);
}

const artifact = target.slice("bun-".length);
const outdir = `./dist/${artifact}`;
const define = target.startsWith("bun-linux-")
  ? { "process.env.OPENTUI_LIBC": JSON.stringify(target.endsWith("-musl") ? "musl" : "glibc") }
  : undefined;

rmSync("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  plugins: [solidPlugin],
  minify: true,
  define,
  compile: {
    target: target as BuildTarget,
    outfile: `${outdir}/codepulse`,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

chmodSync(`${outdir}/codepulse`, 0o755);
console.log(`Built ${outdir}/codepulse (${target})`);

if (process.env.CODEPULSE_BUILD_ASSET_SMOKE === "1") {
  const smokeResult = await Bun.build({
    entrypoints: ["./scripts/smoke-opentui-assets.ts"],
    target: "bun",
    minify: true,
    define,
    compile: {
      target: target as BuildTarget,
      outfile: `${outdir}/smoke-opentui-assets`,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });

  if (!smokeResult.success) {
    console.error(smokeResult.logs);
    process.exit(1);
  }

  chmodSync(`${outdir}/smoke-opentui-assets`, 0o755);
}
