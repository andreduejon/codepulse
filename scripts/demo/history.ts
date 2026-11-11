/**
 * Builds a repository's history from a description, in one `git fast-import`: fast on every OS however many commits
 * and merges it has, and the same hashes every run for the same dates.
 *
 * Each commit names its parents (none for a root, several for a merge). A merge's files follow the parent that
 * changed each file last, like a merge where only one side touched it, so its diff shows what the merged branch
 * brought in. A commit can write files whole or edit the version its parents have, so diffs show real hunks.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** A file's content (text or bytes), or content with a mode (`100755`: executable). */
export type FileValue = string | Uint8Array | { content: string | Uint8Array; mode: "100644" | "100755" };

export interface CommitSpec {
  key: string;
  /** Parent keys: none for a root commit, two or more for a merge. */
  parents: string[];
  /** How long before `now` it was committed. */
  ago: number;
  subject: string;
  body?: string;
  author: string;
  /** Files it writes whole. A non-merge that changes nothing writes one under src/, named after the commit. */
  files?: Record<string, FileValue>;
  /** Files it changes: each gets the version the parents have (after a merge, the merged one). */
  edits?: Record<string, (old: string) => string>;
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
    .replace(/\[bot\]/, "")
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}@demo.invalid`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A commit's own file when it changes nothing else: `src/<scope>/<key>.ts`. */
function defaultFiles(spec: CommitSpec): Record<string, FileValue> {
  const scope = /^\w+\(([^)]+)\)/.exec(spec.subject)?.[1] ?? "misc";
  return { [`src/${slug(scope)}/${slug(spec.key)}.ts`]: `// ${spec.subject}\nexport const done = true;\n` };
}

interface Entry {
  content: string | Uint8Array | null;
  mode: "100644" | "100755";
  /** When it last changed (ms before now); the most recent change wins a merge. */
  ago: number;
}

const sameContent = (a: Entry["content"], b: Entry["content"]) => {
  if (a === null || b === null || typeof a === "string" || typeof b === "string") return a === b;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
};

/** The fast-import stream: every commit on a scratch ref, then the real refs and tags. */
export function fastImportStream(spec: HistorySpec, now: number): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const line = (text: string) => chunks.push(encoder.encode(`${text}\n`));
  const data = (content: string | Uint8Array) => {
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    line(`data ${bytes.length}`);
    chunks.push(bytes);
    line("");
  };
  const marks = new Map<string, number>();
  const trees = new Map<string, Map<string, Entry>>();
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
    const changesSomething =
      commit.files !== undefined || commit.edits !== undefined || commit.deletes !== undefined || parents.length > 1;
    for (const [path, value] of Object.entries(changesSomething ? (commit.files ?? {}) : defaultFiles(commit))) {
      const withMode = typeof value === "object" && !(value instanceof Uint8Array);
      tree.set(path, {
        content: withMode ? value.content : value,
        mode: withMode ? value.mode : (tree.get(path)?.mode ?? "100644"),
        ago: commit.ago,
      });
    }
    for (const [path, edit] of Object.entries(commit.edits ?? {})) {
      const entry = tree.get(path);
      if (typeof entry?.content !== "string") throw new Error(`${commit.key}: no text file ${path} to edit`);
      tree.set(path, { ...entry, content: edit(entry.content), ago: commit.ago });
    }
    for (const path of commit.deletes ?? []) {
      const content = tree.get(path)?.content;
      // An empty file ("") is still a file: only a missing or deleted one (null) has nothing to delete.
      if (content === undefined || content === null) throw new Error(`${commit.key}: no file ${path} to delete`);
      tree.set(path, { content: null, mode: "100644", ago: commit.ago });
    }
    trees.set(commit.key, tree);

    const first = parents[0]?.tree ?? new Map<string, Entry>();
    const message = commit.body ? `${commit.subject}\n\n${commit.body}\n` : `${commit.subject}\n`;
    const who = `${commit.author} <${emailOf(commit.author)}> ${stamp(commit.ago)}`;
    if (parents.length === 0) line(`reset ${SCRATCH}`);
    line(`commit ${SCRATCH}`);
    line(`mark :${mark}`);
    line(`author ${who}`);
    line(`committer ${who}`);
    data(message);
    if (parents.length > 0) line(`from :${marks.get(parents[0].key)}`);
    for (const parent of parents.slice(1)) line(`merge :${marks.get(parent.key)}`);
    for (const [path, entry] of [...tree].sort(([a], [b]) => a.localeCompare(b))) {
      const before = first.get(path);
      if (
        sameContent(entry.content, before?.content ?? null) &&
        (entry.content === null || entry.mode === before?.mode)
      )
        continue;
      if (entry.content === null) line(`D ${path}`);
      else {
        line(`M ${entry.mode} inline ${path}`);
        data(entry.content);
      }
    }
    line("");
  });

  const markOf = (key: string) => {
    const mark = marks.get(key);
    if (!mark) throw new Error(`No commit ${key}`);
    return mark;
  };
  for (const [ref, key] of Object.entries(spec.refs)) {
    line(`reset ${ref}`);
    line(`from :${markOf(key)}`);
    line("");
  }
  for (const tag of spec.tags ?? []) {
    if (!tag.message) {
      line(`reset refs/tags/${tag.name}`);
      line(`from :${markOf(tag.key)}`);
      line("");
      continue;
    }
    const commit = spec.commits[markOf(tag.key) - 1];
    const tagger = tag.author ?? commit.author;
    line(`tag ${tag.name}`);
    line(`from :${markOf(tag.key)}`);
    line(`tagger ${tagger} <${emailOf(tagger)}> ${stamp(commit.ago - 60_000)}`);
    // data() already ends with the newline a tag may have; a second blank line is not a command.
    data(`${tag.message}\n`);
  }
  line(`reset ${SCRATCH}`);
  line("from 0000000000000000000000000000000000000000");
  line("");
  return Buffer.concat(chunks);
}

/** Runs Git in a directory with the demo's environment; `stdin` is fed to it. */
export type GitRunner = (
  cwd: string,
  args: string[],
  extra?: Record<string, string>,
  stdin?: string | Uint8Array,
) => string;

/** Imports the history into `repo` and checks out its HEAD branch. Returns each commit's hash by key. */
export function importHistory(repo: string, spec: HistorySpec, now: number, git: GitRunner): Record<string, string> {
  const marksFile = join(repo, ".git", "demo-marks");
  git(repo, ["fast-import", "--quiet", `--export-marks=${marksFile}`], {}, fastImportStream(spec, now));
  const shas: Record<string, string> = {};
  const byMark = new Map(spec.commits.map((commit, index) => [index + 1, commit.key]));
  for (const text of readFileSync(marksFile, "utf8").split("\n")) {
    const match = /^:(\d+) ([0-9a-f]{40})$/.exec(text.trim());
    const key = match ? byMark.get(Number(match[1])) : undefined;
    if (match && key) shas[key] = match[2];
  }
  rmSync(marksFile);
  git(repo, ["reset", "-q", "--hard"]);
  return shas;
}
