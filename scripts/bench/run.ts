/**
 * The performance and memory bench: builds large repositories, runs each scenario (worker.tsx) in a process of its
 * own with a home of the bench's, and prints the measurements.
 *
 *   bun run bench                 runs every scenario and prints the numbers
 *   bun run bench --save          also keeps them as the baseline (scripts/bench/baseline.json)
 *   bun run bench --compare       prints each number beside the baseline's, with the ratio
 *   bun run bench graph log       only those scenarios
 *
 * Numbers depend on the machine: compare runs on the same one. The baseline names the machine it was made on.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { storageRoot } from "../../src/adapters/system/storage-path";
import { buildBenchRepo } from "./repo";
import type { BenchRepos } from "./worker";

interface Measurement {
  scenario: string;
  name: string;
  value: number;
  unit: string;
}

interface Baseline {
  machine: string;
  date: string;
  commit: string;
  measurements: Measurement[];
}

const SCENARIOS = ["functions", "graph", "app", "dashboard", "switching", "log"] as const;
const here = import.meta.dir;
const repoRoot = join(here, "..", "..");
const baselineFile = join(here, "baseline.json");

function machine(): string {
  return `${platform()} ${release()} ${process.arch}, ${cpus()[0]?.model ?? "unknown CPU"} × ${cpus().length}, Bun ${Bun.version}`;
}

/** A home, config and temp folder of the bench's own, so the user's config and cache stay untouched. */
function benchEnv(root: string): Record<string, string> {
  const home = join(root, "home");
  const temp = join(root, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  });
}

function writeConfig(env: Record<string, string>, repos: BenchRepos) {
  const common = { autoRefreshSeconds: 0, autoFetchSeconds: 0 };
  const config: Record<string, unknown> = {
    [repos.big]: { group: "bench", appName: "big", ...common },
  };
  repos.switching.forEach((path, index) => {
    config[path] = { group: "switch", appName: `switch-${index}`, ...common };
  });
  const folder = storageRoot("config", process.platform, env.HOME, env);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "config.json"), `${JSON.stringify({ repos: config }, null, 2)}\n`);
}

async function runScenario(scenario: string, env: Record<string, string>): Promise<Measurement[]> {
  const child = Bun.spawn([process.execPath, join(here, "worker.tsx"), scenario], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const measured = stdout
    .split("\n")
    .filter(line => line.startsWith("BENCH "))
    .map(line => ({ scenario, ...(JSON.parse(line.slice(6)) as Omit<Measurement, "scenario">) }));
  if (code !== 0 || measured.length === 0)
    throw new Error(`bench scenario ${scenario} failed (exit ${code}):\n${stdout}${stderr}`);
  return measured;
}

const format = (value: number, unit: string) => (unit === "count" ? String(value) : `${value.toFixed(1)} ${unit}`);

async function main(argv: string[]): Promise<number> {
  const save = argv.includes("--save");
  const compare = argv.includes("--compare");
  const chosen = argv.filter(arg => !arg.startsWith("--"));
  const scenarios = SCENARIOS.filter(name => chosen.length === 0 || chosen.includes(name));
  if (scenarios.length === 0) {
    console.error(`No scenario ${chosen.join(", ")}; one of ${SCENARIOS.join(", ")}.`);
    return 2;
  }
  const baseline: Baseline | null =
    compare && existsSync(baselineFile) ? (JSON.parse(readFileSync(baselineFile, "utf8")) as Baseline) : null;
  if (compare && !baseline) console.log("No baseline yet: run with --save first.\n");

  const root = mkdtempSync(join(tmpdir(), "codepulse-bench-"));
  try {
    const env = benchEnv(root);
    const folder = join(root, "repos");
    const started = performance.now();
    const repos: BenchRepos = {
      big: buildBenchRepo(folder, "big", 20_000, 60, env).path,
      switching: [0, 1, 2].map(index => buildBenchRepo(folder, `switch-${index}`, 3_000, 30, env).path),
    };
    writeConfig(env, repos);
    env.CODEPULSE_BENCH_REPOS = JSON.stringify(repos);
    console.log(`${machine()}\nRepositories built in ${((performance.now() - started) / 1000).toFixed(1)} s.\n`);

    const measurements: Measurement[] = [];
    for (const scenario of scenarios) {
      console.log(`── ${scenario}`);
      for (const m of await runScenario(scenario, env)) {
        measurements.push(m);
        const kept = baseline?.measurements.find(b => b.scenario === m.scenario && b.name === m.name);
        const ratio = kept && kept.value !== 0 ? `  ${(m.value / kept.value).toFixed(2)}×` : "";
        const was = kept ? `  (baseline ${format(kept.value, kept.unit)})${ratio}` : "";
        console.log(`  ${m.name.padEnd(64)} ${format(m.value, m.unit).padStart(10)}${was}`);
      }
    }
    if (save) {
      const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: repoRoot }).stdout.toString().trim();
      const kept: Baseline = { machine: machine(), date: new Date().toISOString().slice(0, 10), commit, measurements };
      writeFileSync(baselineFile, `${JSON.stringify(kept, null, 2)}\n`);
      console.log(`\nBaseline kept in ${baselineFile}.`);
    }
    return 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
