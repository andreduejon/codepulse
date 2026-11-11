/**
 * The demo's shop history drawn by the app's graph renderer, every row at full width: each line has to meet another
 * line or a commit, so a renderer change that leaves a line hanging fails here. The history is also checked for the
 * shapes it is there to show.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../../src/git/graph-build";
import { type GraphChar, renderConnectorRow, renderFanOutRow, renderGraphRow } from "../../src/git/graph-render";
import { getMaxGraphColumns, MAX_GRAPH_COLUMNS } from "../../src/git/graph-viewport";
import { getCommits } from "../../src/git/repo";
import type { Commit, GraphRow } from "../../src/git/types";
import { importHistory } from "./history";
import { shopHistory } from "./repositories";

const root = mkdtempSync(join(tmpdir(), "codepulse-demo-graph-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(cwd: string, args: string[], extra: Record<string, string> = {}, stdin?: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "gitconfig"), ...extra },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

let commits: Commit[];
let rows: GraphRow[];
beforeAll(async () => {
  const repo = join(root, "shop");
  git(root, ["init", "-q", "-b", "main", repo]);
  importHistory(repo, shopHistory(), Date.parse("2026-03-02T09:30:00.000Z"), git);
  commits = await getCommits(repo, { all: true, maxCount: 1000 });
  rows = buildGraph(commits);
});

/** Which way each glyph reaches; a commit (█) meets lines from every side. */
const ARMS: Record<string, string> = {
  "│": "ud",
  "─": "lr",
  "┼": "udlr",
  "╮": "ld",
  "╭": "rd",
  "╯": "lu",
  "╰": "ru",
  "┬": "lrd",
  "┴": "lru",
  "├": "udr",
  "┤": "udl",
};

/** The same test as GraphView's: a row with merge or branch connectors keeps its own commit row. */
const rowHasConnections = (row: GraphRow) =>
  row.connectors.some(connector => !["straight", "node", "empty"].includes(connector.type));

/** The graph as GraphView draws it: fan-out rows, the commit row (or the last fan-out row), the connector row. */
function drawGraph(): string[][] {
  const opts = { padToColumns: getMaxGraphColumns(rows) };
  const text = (chars: GraphChar[]) => [...chars.map(gc => gc.char).join("")];
  const lines: string[][] = [];
  rows.forEach((row, index) => {
    const fanOut = (row.fanOutRows ?? []).map(connectors => text(renderFanOutRow(connectors, opts, row.nodeColumn)));
    const merged = fanOut.length > 0 && !rowHasConnections(row);
    lines.push(...(merged ? fanOut.slice(0, -1) : fanOut));
    lines.push(merged ? (fanOut.at(-1) as string[]) : text(renderGraphRow(row, opts)));
    if (index < rows.length - 1) lines.push(text(renderConnectorRow(row, opts)));
  });
  return lines;
}

describe("the demo graph", () => {
  test("has the shapes it is there to show", () => {
    const parents = (count: number) => commits.filter(commit => commit.parents.length === count).length;
    expect(commits.length).toBeGreaterThanOrEqual(80);
    expect(parents(0)).toBe(3);
    expect(parents(2)).toBeGreaterThanOrEqual(15);
    expect(commits.some(commit => commit.parents.length === 5)).toBe(true);
    // More lanes than the graph shows at once, so it scrolls sideways.
    expect(getMaxGraphColumns(rows)).toBeGreaterThan(MAX_GRAPH_COLUMNS);
  });

  test("every line meets another line or a commit", () => {
    const grid = drawGraph();
    const at = (y: number, x: number) => grid[y]?.[x] ?? " ";
    const reaches = (glyph: string, side: string) => glyph === "█" || (ARMS[glyph] ?? "").includes(side);
    const hanging: string[] = [];
    for (const [y, line] of grid.entries()) {
      for (const [x, glyph] of line.entries()) {
        if (glyph === " " || glyph === "█") continue;
        const arms = ARMS[glyph];
        if (!arms) {
          hanging.push(`${y}:${x} unknown glyph ${glyph}`);
          continue;
        }
        if (arms.includes("u") && !reaches(at(y - 1, x), "d")) hanging.push(`${y}:${x} ${glyph} up`);
        if (arms.includes("d") && !reaches(at(y + 1, x), "u")) hanging.push(`${y}:${x} ${glyph} down`);
        if (arms.includes("l") && !reaches(at(y, x - 1), "r")) hanging.push(`${y}:${x} ${glyph} left`);
        if (arms.includes("r") && !reaches(at(y, x + 1), "l")) hanging.push(`${y}:${x} ${glyph} right`);
      }
    }
    expect(hanging).toEqual([]);
  });
});
