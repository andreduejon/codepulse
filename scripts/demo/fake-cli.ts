/**
 * The demo's `snyk`, `npm` and `pnpm`, and its browser and clipboard (world.ts puts them on the app's PATH). A shell
 * script runs this file with the tool's name first; on Windows it is compiled into one executable, named after the
 * tool it stands in for.
 *
 * - `snyk test --json` reports the findings for the checked-out commit's package.json files (packages.ts).
 * - `snyk test --print-graph` prints their dependency graphs.
 * - `npm view` and `pnpm view` answer the override check from the same made-up registry.
 * - `open`, `xdg-open` and PowerShell (`o`), `pbcopy`, `wl-copy`, `xclip` and `clip` (copy) write what they got to
 *   outside.log in the demo folder, instead of opening the user's browser or changing their clipboard.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dependencyTree, type Manifest, registryView, vulnerabilities } from "./packages";
import { BROWSER_COMMANDS, CLIPBOARD_COMMANDS, DEMO_STATE_ENV, loadDemoState, OUTSIDE_LOG } from "./scenario";

const TOOLS = ["snyk", "npm", "pnpm", ...BROWSER_COMMANDS, ...CLIPBOARD_COMMANDS];
const own = basename(process.execPath).replace(/\.exe$/i, "");
const [tool, args] = TOOLS.includes(own)
  ? [own, process.argv.slice(2)]
  : [process.argv[2] ?? "", process.argv.slice(3)];

/** The repository's projects at the checked-out commit, as Snyk's --all-projects finds them. */
function projects(cwd: string): { manifest: Manifest; directory: string; target: string }[] {
  return ["", "admin"].flatMap(directory => {
    const path = join(cwd, directory, "package.json");
    if (!existsSync(path)) return [];
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    return [{ manifest, directory, target: directory ? `${directory}/package-lock.json` : "package-lock.json" }];
  });
}

async function snyk(): Promise<number> {
  if (args.includes("--version")) {
    console.log("1.1300.0 (demo)");
    return 0;
  }
  const state = loadDemoState();
  const cwd = process.cwd();
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd }).stdout.toString().trim();
  const mode = state.providers.snyk;
  const partial = mode === "error:partial";
  const found = projects(cwd);

  // The wip commit on the feature branch does not scan: its npm install fails.
  if (head === state.shas.retry) {
    await Bun.sleep(state.latency * 4);
    console.log(
      JSON.stringify({
        ok: false,
        error: "Failed to get dependencies: npm ERR! code ETARGET No matching version found for retry-policy@^4.0.0.",
        path: cwd,
      }),
    );
    return 2;
  }

  if (args.includes("--print-graph")) {
    const failed = partial ? found.filter(project => project.directory) : [];
    for (const project of found) {
      if (failed.includes(project)) continue;
      console.log(
        `DepGraph data:\n${JSON.stringify(dependencyTree(project.manifest).graph)}\nDepGraph target:\n${project.target}\nDepGraph end`,
      );
    }
    if (failed.length > 0) {
      const lines = failed.flatMap(project => [
        `${join(cwd, project.target)}:`,
        "  npm ERR! code ERESOLVE unable to resolve the dependency tree of shop-admin.",
        "",
      ]);
      console.error(
        [...lines, `${failed.length}/${found.length} potential projects failed to get dependencies.`].join("\n"),
      );
    }
    return 0;
  }

  if (!args.includes("--json")) return 0;
  // A scan takes a moment, so the scanning state shows.
  await Bun.sleep(state.latency * 8);
  const results = found.map(project => {
    if (partial && project.directory)
      return {
        ok: false,
        error: "Could not resolve the dependency tree of shop-admin (npm ERR! code ERESOLVE).",
        path: join(cwd, project.directory),
        targetFile: project.target,
      };
    const issues = mode === "empty" ? [] : vulnerabilities(dependencyTree(project.manifest));
    return {
      ok: issues.length === 0,
      projectName: project.manifest.name,
      displayTargetFile: project.target,
      targetFile: project.target,
      packageManager: "npm",
      dependencyCount: 20,
      vulnerabilities: issues,
      path: join(cwd, project.directory),
    };
  });
  console.log(JSON.stringify(results));
  return results.some(result => (result.vulnerabilities?.length ?? 0) > 0) ? 1 : 0;
}

/** `view NAME[@VERSION] [FIELD] --json`, the only command the app runs. */
function view(): number {
  const [command, spec, field] = args.filter(arg => !arg.startsWith("--"));
  const value = command === "view" && spec ? registryView(spec, field) : undefined;
  if (value === undefined) {
    console.log(JSON.stringify({ error: { code: "E404", summary: `${spec ?? ""} is not in this registry.` } }));
    return 1;
  }
  console.log(JSON.stringify(value));
  return 0;
}

/** What `o` or copy would hand the host, written down in the demo folder. */
async function outside(kind: "browser" | "clipboard"): Promise<number> {
  // PowerShell gets the URL in an environment variable (src/utils/open-url.ts), the others as the last argument.
  const text = kind === "browser" ? (process.env.CODEPULSE_OPEN_URL ?? args.at(-1) ?? "") : await Bun.stdin.text();
  const state = process.env[DEMO_STATE_ENV];
  if (!state) return 1;
  appendFileSync(join(dirname(state), OUTSIDE_LOG), `${kind} ${text}\n`);
  return 0;
}

const code =
  tool === "snyk"
    ? await snyk()
    : tool === "npm" || tool === "pnpm"
      ? view()
      : BROWSER_COMMANDS.includes(tool)
        ? await outside("browser")
        : CLIPBOARD_COMMANDS.includes(tool)
          ? await outside("clipboard")
          : 127;
if (code === 127) console.error(`The demo has no fake for "${tool}".`);
process.exit(code);
