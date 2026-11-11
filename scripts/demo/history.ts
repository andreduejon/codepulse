/**
 * Builds a repository's history from a description, in one `git fast-import`: fast on every OS however many commits
 * and merges it has, and the same hashes every run for the same dates.
 *
 * Each commit names its parents (none for a root, several for a merge). A merge's files follow the parent that
 * changed each file last, like a merge where only one side touched it, so its diff shows what the merged branch
 * brought in.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface CommitSpec {
  key: string;
  /** Parent keys: none for a root commit, two or more for a merge. */
  parents: string[];
  /** How long before `now` it was committed. */
  ago: number;
  subject: string;
  body?: string;
  author: string;
  /** Files it writes. A non-merge without files writes one under src/, named after the commit. */
  files?: Record<string, string>;
  deletes?: string[];
}

export interface TagSpec {
  name: string;
  key: string;
  /** An annotated tag's message; without it the tag is lightweight. */
  message?: string;
  author?: string;
}

export interface HistorySpec {
  commits: CommitSpec[];
  /** Ref name (`refs/heads/main`, `refs/demo/next-dev`) to commit key. */
  refs: Record<string, string>;
  tags?: TagSpec[];
}

export const emailOf = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}@demo.invalid`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A commit's own file when it names none: `src/<scope>/<key>.ts`. */
function defaultFiles(spec: CommitSpec): Record<string, string> {
  const scope = /^\w+\(([^)]+)\)/.exec(spec.subject)?.[1] ?? "misc";
  return { [`src/${slug(scope)}/${slug(spec.key)}.ts`]: `// ${spec.subject}\nexport const done = true;\n` };
}

interface Entry {
  content: string | null;
  /** When it last changed (ms before now); the most recent change wins a merge. */
  ago: number;
}

/** The fast-import stream: every commit on a scratch ref, then the real refs and tags. */
export function fastImportStream(spec: HistorySpec, now: number): string {
  const marks = new Map<string, number>();
  const trees = new Map<string, Map<string, Entry>>();
  const out: string[] = [];
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const stamp = (ago: number) => `${Math.floor((now - ago) / 1000)} +0000`;
  const SCRATCH = "refs/demo/import";

  spec.commits.forEach((commit, index) => {
    const mark = index + 1;
    marks.set(commit.key, mark);
    const parents = commit.parents.map(key => {
      const tree = trees.get(key);
      if (!tree) throw new Error(`${commit.key}: parent ${key} comes later or does not exist`);
      return { key, tree };
    });
    const tree = new Map<string, Entry>();
    for (const parent of parents)
      for (const [path, entry] of parent.tree) {
        const current = tree.get(path);
        if (!current || entry.ago < current.ago) tree.set(path, entry);
      }
    const own = commit.files ?? (parents.length > 1 ? {} : defaultFiles(commit));
    for (const [path, content] of Object.entries(own)) tree.set(path, { content, ago: commit.ago });
    for (const path of commit.deletes ?? []) tree.set(path, { content: null, ago: commit.ago });
    trees.set(commit.key, tree);

    const first = parents[0]?.tree ?? new Map<string, Entry>();
    const message = commit.body ? `${commit.subject}\n\n${commit.body}\n` : `${commit.subject}\n`;
    const who = `${commit.author} <${emailOf(commit.author)}> ${stamp(commit.ago)}`;
    if (parents.length === 0) out.push(`reset ${SCRATCH}`);
    out.push(`commit ${SCRATCH}`, `mark :${mark}`, `author ${who}`, `committer ${who}`, data(message).trimEnd());
    if (parents.length > 0) out.push(`from :${marks.get(parents[0].key)}`);
    for (const parent of parents.slice(1)) out.push(`merge :${marks.get(parent.key)}`);
    for (const [path, entry] of [...tree].sort(([a], [b]) => a.localeCompare(b))) {
      const before = first.get(path)?.content ?? null;
      if (entry.content === before) continue;
      if (entry.content === null) out.push(`D ${path}`);
      else out.push(`M 100644 inline ${path}`, data(entry.content).trimEnd());
    }
    out.push("");
  });

  const markOf = (key: string) => {
    const mark = marks.get(key);
    if (!mark) throw new Error(`No commit ${key}`);
    return mark;
  };
  for (const [ref, key] of Object.entries(spec.refs)) out.push(`reset ${ref}`, `from :${markOf(key)}`, "");
  for (const tag of spec.tags ?? []) {
    if (!tag.message) {
      out.push(`reset refs/tags/${tag.name}`, `from :${markOf(tag.key)}`, "");
      continue;
    }
    const commit = spec.commits[markOf(tag.key) - 1];
    const tagger = tag.author ?? commit.author;
    out.push(
      `tag ${tag.name}`,
      `from :${markOf(tag.key)}`,
      `tagger ${tagger} <${emailOf(tagger)}> ${stamp(commit.ago - 60_000)}`,
      data(`${tag.message}\n`).trimEnd(),
      "",
    );
  }
  out.push(`reset ${SCRATCH}`, "from 0000000000000000000000000000000000000000", "");
  return `${out.join("\n")}\n`;
}

/**
 * Imports the history into `repo` and checks out its HEAD branch. Returns each commit's hash by key.
 * `git` runs Git in a directory with the demo's environment.
 */
export function importHistory(
  repo: string,
  spec: HistorySpec,
  now: number,
  git: (cwd: string, args: string[], extra?: Record<string, string>, stdin?: string) => string,
): Record<string, string> {
  const marksFile = join(repo, ".git", "demo-marks");
  git(repo, ["fast-import", "--quiet", `--export-marks=${marksFile}`], {}, fastImportStream(spec, now));
  const shas: Record<string, string> = {};
  const byMark = new Map(spec.commits.map((commit, index) => [index + 1, commit.key]));
  for (const line of readFileSync(marksFile, "utf8").split("\n")) {
    const match = /^:(\d+) ([0-9a-f]{40})$/.exec(line.trim());
    const key = match ? byMark.get(Number(match[1])) : undefined;
    if (match && key) shas[key] = match[2];
  }
  rmSync(marksFile);
  git(repo, ["reset", "-q", "--hard"]);
  return shas;
}
