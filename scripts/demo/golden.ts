/**
 * Golden plays: a fixed set of headless demo plays whose screens are kept in `scripts/demo/golden/`. A refactoring
 * step should leave every screen as it was; a change to the UI shows here as the screens it changed.
 *
 *   bun run demo:golden            plays them all and shows each screen line that changed (exits with 1 if any did)
 *   bun run demo:golden --update   plays them and writes the screens they print now
 *   bun run demo:golden dashboard  only the plays whose name contains "dashboard"
 *
 * Screens are a fixed grid, so a changed screen is shown line by line: `-` as kept, `+` as printed now.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface GoldenPlay {
  name: string;
  /** What it covers, for whoever reads a changed screen. */
  covers: string;
  args: string[];
}

const WIDE = ["--size", "200x45"];
const COMPACT = ["--size", "160x45"];

export const GOLDEN_PLAYS: readonly GoldenPlay[] = [
  {
    name: "graph-wide",
    covers: "graph selection, the side panel's tabs and files, the diff dialog and back",
    args: [
      ...WIDE,
      "--play",
      'shot:start j j shot:selected right shot:files down*3 enter wait:"esc close" shot:diff esc shot:back right shot:info left left shot:graph',
    ],
  },
  {
    name: "graph-compact",
    covers: "the compact details dialog: open, its tabs, close",
    args: [...COMPACT, "--play", "j j enter shot:dialog right shot:info esc shot:closed"],
  },
  {
    name: "views-compact",
    covers: "the graph's compact details and the Dashboard: each keeps its own, away and back",
    args: [
      ...COMPACT,
      "--play",
      "j j enter shot:details tab tab tab tab tab shot:dashboard tab shot:back j shot:after-j",
    ],
  },
  {
    name: "highlights",
    covers: "search, ancestry and path modes, and Esc out of each",
    args: [
      ...WIDE,
      "--play",
      "/ type:retry enter shot:search esc shot:search-cleared j a shot:ancestry esc p type:src/payments enter " +
        'wait:"path" shot:path esc shot:normal',
    ],
  },
  {
    name: "providers",
    covers: "each provider tab with its details, OpenShift's Events tab, a CI log, an OpenShift resource log, Snyk",
    args: [
      ...WIDE,
      "--play",
      [
        "j j",
        'tab wait:"CI #812" right shot:github',
        'esc tab wait:"main #41" right shot:jenkins',
        "esc g tab wait:pull9 right shot:openshift",
        // The first commit has no warnings yet; the one shop-test runs has several.
        'right wait:"total events" esc j j j j right right wait:"BackOff" j shot:openshift-events',
        'esc tab wait:"Vulnerabilities" shot:snyk',
      ].join("\n"),
    ],
  },
  {
    name: "openshift-cached",
    covers: "the next phase: (cached) in the Events tab (a replaced pod, a deleted event), the Cached section of the events",
    args: [
      ...WIDE,
      "--play",
      [
        // The next phase has no BuildFailed event any more: only the cache keeps it.
        'click:OpenShift wait:"64ddc8a" advance type::reload enter',
        'click:64ddc8a enter right wait:"shop-api-41 (cached)" shot:events',
        'click:"shop-api-41 (cached)" enter wait:"Cached (no longer" shot:dialog',
      ].join("\n"),
    ],
  },
  {
    name: "logs",
    covers: "the CI job log dialog: views, search, Esc back to the details",
    args: [
      ...WIDE,
      "--play",
      [
        'j j tab wait:"CI #812" right',
        'down enter wait:"esc close" shot:log',
        "c shot:issues c c c",
        "/ type:retry enter shot:search esc esc",
        'gone:"esc close" shot:back',
      ].join("\n"),
    ],
  },
  {
    name: "dashboard-wide",
    covers: "the Dashboard with its side panel, the panel's keyboard, Show in provider",
    args: [
      ...WIDE,
      "--play",
      [
        'click:Dashboard wait:"events" shot:dashboard',
        "j j shot:selected",
        "right shot:panel-focused down shot:panel-down left shot:back",
        "enter shot:shown-in-provider",
      ].join("\n"),
    ],
  },
  {
    name: "dashboard-compact",
    covers: "the Dashboard's compact dialog and s",
    args: [
      ...COMPACT,
      "--play",
      'click:Dashboard wait:"events" j j enter shot:dialog esc shot:closed j enter s shot:shown-in-provider',
    ],
  },
  {
    name: "dialogs",
    covers: "menu tabs, help, the theme dialog",
    args: [
      ...WIDE,
      "--play",
      "m shot:menu right shot:branches right shot:providers esc ? shot:help esc : type:theme enter shot:theme esc shot:closed",
    ],
  },
  {
    name: "errors",
    covers: "provider failures: a tab's banner and the Dashboard's error box",
    args: [
      ...WIDE,
      "--github",
      "error:401",
      "--jenkins",
      "error:offline",
      "--play",
      'tab wait:"GitHub" shot:github-error click:Dashboard wait:"Errors from" shot:dashboard-errors',
    ],
  },
  {
    name: "repositories",
    covers: "switching apps of the group, and ctrl+f's warnings in shop-web",
    args: [
      ...WIDE,
      "--play",
      'shift+right wait:shop-web shot:shop-web ctrl+f wait:"not fast-forwarded" shot:fast-forward shift+left wait:"86 commits" shot:shop',
    ],
  },
  {
    name: "colors",
    covers: "the Dashboard and a provider tab with every color named, so a color change shows",
    args: [
      ...WIDE,
      "--colors",
      "--play",
      'j j click:Dashboard wait:"events" j shot:dashboard tab tab wait:"CI #812" shot:github',
    ],
  },
];

const here = import.meta.dir;
const repoRoot = join(here, "..", "..");
const goldenDir = join(here, "golden");

async function playOnce(play: GoldenPlay): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, join(here, "run.ts"), ...play.args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

/**
 * The output with the demo's folder masked: it is a new temporary folder each run (and another one on each machine),
 * and the menu shows the repository's path in it.
 */
export function withoutDemoFolder(output: string): string {
  return output.replace(/\S*[\\/]home[\\/]code[\\/](\S+)/g, "<demo folder>/home/code/$1");
}

/** The screens of a play's output, by their `=== shot … ===` titles. */
function screens(output: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("=== ")) {
      current = [];
      result.set(line, current);
    } else current?.push(line);
  }
  return result;
}

/** Each screen that differs, line by line. Empty when the outputs match. */
export function screenDifferences(kept: string, now: string): string[] {
  const before = screens(kept);
  const after = screens(now);
  const out: string[] = [];
  for (const title of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(title);
    const b = after.get(title);
    if (!a) {
      out.push(`${title} is new`);
      continue;
    }
    if (!b) {
      out.push(`${title} is gone`);
      continue;
    }
    const changed: string[] = [];
    for (let row = 0; row < Math.max(a.length, b.length); row++) {
      if (a[row] === b[row]) continue;
      changed.push(`  line ${row + 1}`, `  - ${a[row] ?? ""}`, `  + ${b[row] ?? ""}`);
    }
    if (changed.length > 0) out.push(title, ...changed);
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const update = argv.includes("--update");
  const filters = argv.filter(arg => !arg.startsWith("--"));
  const plays = GOLDEN_PLAYS.filter(play => filters.length === 0 || filters.some(f => play.name.includes(f)));
  if (plays.length === 0) {
    console.error(`No golden play matches ${filters.join(", ")}.`);
    return 2;
  }
  mkdirSync(goldenDir, { recursive: true });
  // A few at a time: each is a whole app with its own Git repositories.
  const results = new Map<string, Awaited<ReturnType<typeof playOnce>>>();
  const queue = [...plays];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let play = queue.shift(); play; play = queue.shift()) results.set(play.name, await playOnce(play));
    }),
  );

  let failed = false;
  for (const play of plays) {
    const result = results.get(play.name);
    if (!result) continue;
    const file = join(goldenDir, `${play.name}.txt`);
    if (result.code !== 0) {
      failed = true;
      console.log(`✗ ${play.name}: the play failed (exit ${result.code})\n${result.stdout}${result.stderr}`);
      continue;
    }
    const printed = withoutDemoFolder(result.stdout);
    if (update) {
      writeFileSync(file, printed);
      console.log(`✓ ${play.name}: written`);
      continue;
    }
    if (!existsSync(file)) {
      failed = true;
      console.log(`✗ ${play.name}: no kept screens yet (run with --update)`);
      continue;
    }
    const differences = screenDifferences(readFileSync(file, "utf8"), printed);
    if (differences.length === 0) console.log(`✓ ${play.name}`);
    else {
      failed = true;
      console.log(`✗ ${play.name} (${play.covers})\n${differences.join("\n")}`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
