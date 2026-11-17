/**
 * The bench's repositories: large, deterministic histories built in one `git fast-import` (the demo's importer).
 * The shape is what makes the graph work hard: a main line, a pull request merged every few commits, long-lived lanes
 * that merge back now and then, tags, and many branches, local and remote.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type CommitSpec, type GitRunner, type HistorySpec, importHistory, type TagSpec } from "../demo/history";

const AUTHORS = ["Mei Chen", "Noah Park", "Sam O'Brien", "Ana Lima", "Demo Dev", "Ravi Shah"];
/** Long-lived branches beside main: they keep the graph several lanes wide. */
const LANES = 6;
/** Branch refs kept for the newest pull requests (local and on origin). */
const KEPT_FEATURES = 40;
const FILES = 400;
/** The newest commit of a bench repository, by its name: what shows first in the graph once it loads. */
export const newestSubject = (name: string) => `chore: the newest commit in ${name}`;

export interface BenchRepo {
  path: string;
  commits: number;
}

/** A history of about `total` commits spread over `spanMs` before now. */
export function benchHistory(name: string, total: number, spanMs: number): HistorySpec {
  const commits: CommitSpec[] = [];
  const refs: Record<string, string> = {};
  const tags: TagSpec[] = [];
  const add = (parents: string[], subject: string): string => {
    const n = commits.length;
    const key = `c${n}`;
    commits.push({
      key,
      parents,
      ago: Math.round(spanMs * (1 - n / total)),
      subject,
      author: AUTHORS[n % AUTHORS.length] ?? "Demo Dev",
      // A merge's files follow its parents; anything else changes one of a bounded set of files.
      ...(parents.length > 1 ? {} : { files: { [`src/m${n % FILES}.ts`]: `export const v${n} = ${n};\n` } }),
    });
    return key;
  };

  let main = add([], "initial commit");
  const lanes = Array.from({ length: LANES }, (_, lane) => add([main], `lane ${lane}: start`));
  const features: string[] = [];
  for (let step = 1; commits.length < total - 6; step++) {
    main = add([main], `feat(core): change ${step}`);
    if (step % 3 === 0) {
      const first = add([main], `feat(feature-${step}): first part`);
      const second = add([first], `feat(feature-${step}): second part`);
      main = add([main, second], `Merge pull request #${step} from bench/feature-${step}`);
      features.push(second);
    }
    if (step % 5 === 0) {
      const lane = (step / 5) % LANES;
      lanes[lane] = add([lanes[lane] ?? main], `lane ${lane}: work ${step}`);
    }
    if (step % 97 === 0) {
      const lane = step % LANES;
      main = add([main, lanes[lane] ?? main], `Merge branch 'lane-${lane}'`);
    }
    if (step % 150 === 0)
      tags.push({
        name: `v1.${step / 150}.0`,
        key: main,
        ...(step % 300 === 0 ? { message: `Release ${step / 150}` } : {}),
      });
  }
  main = add([main], newestSubject(name));

  refs["refs/heads/main"] = main;
  refs["refs/remotes/origin/main"] = main;
  lanes.forEach((tip, lane) => {
    refs[`refs/heads/lane-${lane}`] = tip;
    refs[`refs/remotes/origin/lane-${lane}`] = tip;
  });
  features.slice(-KEPT_FEATURES).forEach((tip, index) => {
    refs[`refs/heads/feature/${index}`] = tip;
    refs[`refs/remotes/origin/feature/${index}`] = tip;
  });
  return { commits, refs, tags };
}

/** Git in `cwd` with the bench's environment; `stdin` is fed to it. */
export function benchGit(env: Record<string, string>): GitRunner {
  return (cwd, args, extra = {}, stdin) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...env, ...extra },
      stdin: stdin === undefined ? "ignore" : typeof stdin === "string" ? new TextEncoder().encode(stdin) : stdin,
    });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
}

/** Builds a repository of about `total` commits over `days` days, with a remote URL, in `folder/name`. */
export function buildBenchRepo(
  folder: string,
  name: string,
  total: number,
  days: number,
  env: Record<string, string>,
): BenchRepo {
  const path = join(folder, name);
  mkdirSync(path, { recursive: true });
  const git = benchGit(env);
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["remote", "add", "origin", `git@github.com:bench/${name}.git`]);
  const spec = benchHistory(name, total, days * 86_400_000);
  importHistory(path, spec, Date.now(), git);
  return { path: git(path, ["rev-parse", "--show-toplevel"]), commits: spec.commits.length };
}
