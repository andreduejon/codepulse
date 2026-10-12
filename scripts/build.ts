import { chmodSync, rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

const supportedTargets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-x64",
  "bun-windows-x64",
  "bun-windows-arm64",
] as const;

type BuildTarget = (typeof supportedTargets)[number];

function getHostTarget(): BuildTarget {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const target = `bun-${platform}-${process.arch}`;
  if (supportedTargets.includes(target as BuildTarget)) return target as BuildTarget;
  throw new Error(`Unsupported build host: ${process.platform}-${process.arch}`);
}

const target = process.env.CODEPULSE_BUILD_TARGET ?? getHostTarget();
if (!supportedTargets.includes(target as BuildTarget)) {
  throw new Error(`Unsupported build target: ${target}`);
}

const artifact = target.slice("bun-".length);
const outdir = `./dist/${artifact}`;
const isWindows = target.startsWith("bun-windows-");
const extension = isWindows ? ".exe" : "";
const outfile = `${outdir}/codepulse${extension}`;
const define = target.startsWith("bun-linux-") ? { "process.env.OPENTUI_LIBC": JSON.stringify("glibc") } : undefined;

rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  plugins: [solidPlugin],
  minify: true,
  define,
  compile: {
    target: target as BuildTarget,
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

if (!isWindows) chmodSync(outfile, 0o755);
console.log(`Built ${outfile} (${target})`);

if (process.env.CODEPULSE_BUILD_ASSET_SMOKE === "1") {
  const smokeOutfile = `${outdir}/smoke-opentui-assets${extension}`;
  const smokeResult = await Bun.build({
    entrypoints: ["./scripts/smoke-opentui-assets.ts"],
    target: "bun",
    minify: true,
    define,
    compile: {
      target: target as BuildTarget,
      outfile: smokeOutfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });

  if (!smokeResult.success) {
    console.error(smokeResult.logs);
    process.exit(1);
  }

  if (!isWindows) chmodSync(smokeOutfile, 0o755);
}
