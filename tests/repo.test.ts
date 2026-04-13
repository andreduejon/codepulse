/**
 * Test: verifies the pure parsing functions in repo.ts.
 *
 * Covers: parseRefs (ref decoration parsing), parseCommitLine (log line parsing),
 * and the RS (record separator) constant.
 *
 * These are unit tests for the parsing layer — they don't spawn git subprocesses.
 */
import { describe, expect, test } from "bun:test";
import { computeFileWidths } from "../src/components/detail-types";
import {
  parseCommitLine,
  parseDiffTreeOutput,
  parseNumstatOutput,
  parseRefs,
  parseStashEntry,
  parseStatusPorcelain,
  parseTagLine,
  parseTrackInfo,
  RS,
  resolveRenamePath,
} from "../src/git/repo";

describe("repo.ts parsing", () => {
  test("parseRefs — empty/blank string returns []", () => {
    const refs = parseRefs("", new Set());
    expect(refs.length).toBe(0);

    const refs2 = parseRefs("   ", new Set());
    expect(refs2.length).toBe(0);
  });

  test("parseRefs — HEAD -> branch", () => {
    const refs = parseRefs("HEAD -> main", new Set(["origin"]));
    expect(refs.length).toBe(1);
    expect(refs[0].name).toBe("main");
    expect(refs[0].type).toBe("branch");
    expect(refs[0].isCurrent).toBe(true);
  });

  test("parseRefs — bare HEAD (detached)", () => {
    const refs = parseRefs("HEAD", new Set());
    expect(refs.length).toBe(1);
    expect(refs[0].name).toBe("HEAD");
    expect(refs[0].type).toBe("head");
    expect(refs[0].isCurrent).toBe(true);
  });

  test("parseRefs — tag decoration", () => {
    const refs = parseRefs("tag: v1.0.0", new Set());
    expect(refs.length).toBe(1);
    expect(refs[0].name).toBe("v1.0.0");
    expect(refs[0].type).toBe("tag");
    expect(refs[0].isCurrent).toBe(false);
  });

  test("parseRefs — remote branch detection", () => {
    const remotes = new Set(["origin", "upstream"]);

    // origin/main should be detected as remote
    const refs1 = parseRefs("origin/main", remotes);
    expect(refs1.length).toBe(1);
    expect(refs1[0].type).toBe("remote");
    expect(refs1[0].name).toBe("origin/main");

    // upstream/feature should be detected as remote
    const refs2 = parseRefs("upstream/feature", remotes);
    expect(refs2[0].type).toBe("remote");

    // refs/remotes/ prefix is also remote regardless of remoteNames
    const refs3 = parseRefs("refs/remotes/origin/main", new Set());
    expect(refs3[0].type).toBe("remote");
  });

  test("parseRefs — local branch with slash", () => {
    // feature/my-feature contains "/" but is not prefixed by a known remote
    const refs = parseRefs("feature/my-feature", new Set(["origin"]));
    expect(refs.length).toBe(1);
    expect(refs[0].type).toBe("branch");
    expect(refs[0].name).toBe("feature/my-feature");
  });

  test("parseRefs — stash refs are classified as stash", () => {
    // refs/stash (raw ref that git log --all may produce)
    const refs1 = parseRefs("refs/stash", new Set(["origin"]));
    expect(refs1.length).toBe(1);
    expect(refs1[0].type).toBe("stash");
    expect(refs1[0].isCurrent).toBe(false);

    // stash@{N} (synthetic refs from our stash injection)
    const refs2 = parseRefs("stash@{0}", new Set());
    expect(refs2.length).toBe(1);
    expect(refs2[0].type).toBe("stash");
    expect(refs2[0].name).toBe("stash@{0}");

    const refs3 = parseRefs("stash@{2}", new Set());
    expect(refs3[0].type).toBe("stash");
  });

  test("parseRefs — multiple refs on one commit", () => {
    const refStr = "HEAD -> develop, origin/develop, tag: v2.0";
    const refs = parseRefs(refStr, new Set(["origin"]));
    expect(refs.length).toBe(3);

    expect(refs[0].name).toBe("develop");
    expect(refs[0].type).toBe("branch");
    expect(refs[0].isCurrent).toBe(true);

    expect(refs[1].name).toBe("origin/develop");
    expect(refs[1].type).toBe("remote");

    expect(refs[2].name).toBe("v2.0");
    expect(refs[2].type).toBe("tag");
  });

  test("parseCommitLine — valid line", () => {
    const hash = "abc123def456abc123def456abc123def456abc1";
    const shortHash = "abc123d";
    const parents = "parent1 parent2";
    const refStr = "HEAD -> main, tag: v1.0";
    const subject = "fix: something important";
    const author = "Test Author";
    const email = "test@example.com";
    const date = "2024-01-15T10:30:00+01:00";
    const committer = "Other Person";
    const committerEmail = "other@example.com";
    const commitDate = "2024-01-15T11:00:00+01:00";

    const line = [
      hash,
      shortHash,
      parents,
      refStr,
      subject,
      author,
      email,
      date,
      committer,
      committerEmail,
      commitDate,
    ].join(RS);

    const commit = parseCommitLine(line, new Set(["origin"]));
    expect(commit).not.toBeNull();
    if (!commit) throw new Error("commit not found");

    expect(commit.hash).toBe(hash);
    expect(commit.shortHash).toBe(shortHash);
    expect(commit.parents.length).toBe(2);
    expect(commit.parents[0]).toBe("parent1");
    expect(commit.parents[1]).toBe("parent2");
    expect(commit.subject).toBe(subject);
    expect(commit.body).toBe("");
    expect(commit.author).toBe(author);
    expect(commit.authorEmail).toBe(email);
    expect(commit.authorDate).toBe(date);
    expect(commit.committer).toBe(committer);
    expect(commit.committerEmail).toBe(committerEmail);
    expect(commit.commitDate).toBe(commitDate);

    // Refs
    expect(commit.refs.length).toBe(2);
    expect(commit.refs[0].name).toBe("main");
    expect(commit.refs[0].type).toBe("branch");
    expect(commit.refs[0].isCurrent).toBe(true);
    expect(commit.refs[1].name).toBe("v1.0");
    expect(commit.refs[1].type).toBe("tag");
  });

  test("parseCommitLine — root commit (no parents)", () => {
    const fields = [
      "aaa111",
      "aaa111",
      "",
      "",
      "Initial commit",
      "Author",
      "a@b.com",
      "2024-01-01T00:00:00Z",
      "Author",
      "a@b.com",
      "2024-01-01T00:00:00Z",
    ];
    const line = fields.join(RS);

    const commit = parseCommitLine(line, new Set());
    expect(commit).not.toBeNull();
    if (!commit) throw new Error("commit not found");
    expect(commit.parents.length).toBe(0);
    expect(commit.refs.length).toBe(0);
  });

  test("parseCommitLine — malformed line", () => {
    const result = parseCommitLine(`abc${RS}def${RS}ghi`, new Set());
    expect(result).toBeNull();

    const result2 = parseCommitLine("", new Set());
    expect(result2).toBeNull();
  });

  test("RS constant is ASCII 0x1E", () => {
    expect(RS).toBe("\x1e");
    expect(RS.length).toBe(1);
    expect(RS.codePointAt(0)).toBe(0x1e);
  });

  test("parseCommitLine — subject with special characters", () => {
    const specialSubject = "fix(scope): handle <angle> & \"quotes\" + 'apostrophes'";
    const fields = [
      "bbb222",
      "bbb222",
      "parent1",
      "",
      specialSubject,
      "Author",
      "a@b.com",
      "2024-06-15T12:00:00Z",
      "Author",
      "a@b.com",
      "2024-06-15T12:00:00Z",
    ];
    const line = fields.join(RS);

    const commit = parseCommitLine(line, new Set());
    expect(commit).not.toBeNull();
    if (!commit) throw new Error("commit not found");
    expect(commit.subject).toBe(specialSubject);
  });
});

describe("parseTagLine", () => {
  test("annotated tag with full info", () => {
    const line = ["refs/tags/v1.0.0", "tag", "Jane Doe", "2024-06-15T12:00:00+02:00", "Release v1.0.0"].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    if (!tag) throw new Error("tag not found");
    expect(tag.name).toBe("v1.0.0");
    expect(tag.type).toBe("annotated");
    expect(tag.tagger).toBe("Jane Doe");
    expect(tag.taggerDate).toBe("2024-06-15T12:00:00+02:00");
    expect(tag.message).toBe("Release v1.0.0");
  });

  test("lightweight tag", () => {
    const line = ["refs/tags/v0.1.0", "commit", "", "", ""].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    if (!tag) throw new Error("tag not found");
    expect(tag.name).toBe("v0.1.0");
    expect(tag.type).toBe("lightweight");
    expect(tag.tagger).toBeUndefined();
    expect(tag.taggerDate).toBeUndefined();
    expect(tag.message).toBeUndefined();
  });

  test("annotated tag with empty tagger/message", () => {
    const line = ["refs/tags/v2.0", "tag", "", "", ""].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    if (!tag) throw new Error("tag not found");
    expect(tag.name).toBe("v2.0");
    expect(tag.type).toBe("annotated");
    expect(tag.tagger).toBeUndefined();
    expect(tag.taggerDate).toBeUndefined();
    expect(tag.message).toBeUndefined();
  });

  test("malformed line returns null", () => {
    expect(parseTagLine("")).toBeNull();
    expect(parseTagLine(`refs/tags/v1${RS}tag`)).toBeNull();
  });

  test("strips refs/tags/ prefix from name", () => {
    const line = ["refs/tags/release/v3.0", "commit", "", "", ""].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    if (!tag) throw new Error("tag not found");
    expect(tag.name).toBe("release/v3.0");
  });
});

describe("parseTrackInfo", () => {
  test("ahead only", () => {
    const result = parseTrackInfo("ahead 3");
    expect(result.ahead).toBe(3);
    expect(result.behind).toBeUndefined();
  });

  test("behind only", () => {
    const result = parseTrackInfo("behind 5");
    expect(result.ahead).toBeUndefined();
    expect(result.behind).toBe(5);
  });

  test("ahead and behind", () => {
    const result = parseTrackInfo("ahead 3, behind 2");
    expect(result.ahead).toBe(3);
    expect(result.behind).toBe(2);
  });

  test("empty string (up to date)", () => {
    const result = parseTrackInfo("");
    expect(result.ahead).toBeUndefined();
    expect(result.behind).toBeUndefined();
  });

  test("whitespace only", () => {
    const result = parseTrackInfo("   ");
    expect(result.ahead).toBeUndefined();
    expect(result.behind).toBeUndefined();
  });

  test("gone (upstream deleted)", () => {
    // git outputs "gone" when the upstream branch has been deleted
    const result = parseTrackInfo("gone");
    expect(result.ahead).toBeUndefined();
    expect(result.behind).toBeUndefined();
  });
});

describe("parseStashEntry", () => {
  test("basic stash entry with two parents", () => {
    const line = [
      "abc123def456abc123def456abc123def456abc123", // hash
      "abc123d", // shortHash
      "parent1111 parent2222", // parents (HEAD + index)
      "stash@{0}", // stashRef
      "WIP on main: fix typo", // subject
      "John Doe", // author
      "john@example.com", // authorEmail
      "2024-06-15T12:00:00+02:00", // authorDate
      "John Doe", // committer
      "john@example.com", // committerEmail
      "2024-06-15T12:00:00+02:00", // commitDate
    ].join(RS);

    const entry = parseStashEntry(line);
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("entry not found");
    expect(entry.hash).toBe("abc123def456abc123def456abc123def456abc123");
    expect(entry.shortHash).toBe("abc123d");
    // Only first parent used for graph topology
    expect(entry.parents).toEqual(["parent1111"]);
    expect(entry.subject).toBe("WIP on main: fix typo");
    expect(entry.author).toBe("John Doe");
    expect(entry.refs).toHaveLength(1);
    expect(entry.refs[0].name).toBe("stash@{0}");
    expect(entry.refs[0].type).toBe("stash");
    expect(entry.refs[0].isCurrent).toBe(false);
  });

  test("stash with three parents (untracked files)", () => {
    const line = [
      "aaa111bbb222ccc333ddd444eee555fff666aaa111",
      "aaa111b",
      "parent1 parent2 parent3",
      "stash@{2}",
      "On feature: WIP",
      "Jane",
      "jane@example.com",
      "2024-07-01T10:00:00Z",
      "Jane",
      "jane@example.com",
      "2024-07-01T10:00:00Z",
    ].join(RS);

    const entry = parseStashEntry(line);
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("entry not found");
    // Only first parent used
    expect(entry.parents).toEqual(["parent1"]);
    expect(entry.refs[0].name).toBe("stash@{2}");
  });

  test("malformed line returns null", () => {
    expect(parseStashEntry("")).toBeNull();
    expect(parseStashEntry(`only${RS}two`)).toBeNull();
  });

  test("line with no parents returns null", () => {
    const line = [
      "abc123def456abc123def456abc123def456abc123",
      "abc123d",
      "", // empty parents
      "stash@{0}",
      "WIP",
      "Author",
      "a@b.com",
      "2024-01-01T00:00:00Z",
      "Author",
      "a@b.com",
      "2024-01-01T00:00:00Z",
    ].join(RS);

    const entry = parseStashEntry(line);
    expect(entry).toBeNull();
  });

  test("stash ref label preserved in badge", () => {
    const line = [
      "fff000aaa111bbb222ccc333ddd444eee555fff000",
      "fff000a",
      "parenthash123",
      "stash@{5}",
      "On develop: saving progress",
      "Dev",
      "dev@co.com",
      "2024-12-25T08:00:00Z",
      "Dev",
      "dev@co.com",
      "2024-12-25T08:00:00Z",
    ].join(RS);

    const entry = parseStashEntry(line);
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("entry not found");
    expect(entry.refs[0].name).toBe("stash@{5}");
    expect(entry.refs[0].type).toBe("stash");
  });
});

describe("parseStatusPorcelain", () => {
  test("returns null for empty output", () => {
    expect(parseStatusPorcelain("")).toBeNull();
    expect(parseStatusPorcelain("  \n  ")).toBeNull();
  });

  test("counts staged files (index column)", () => {
    const output = "M  src/app.ts\nA  src/new.ts\nD  old.ts\n";
    const result = parseStatusPorcelain(output);
    expect(result).not.toBeNull();
    if (!result) throw new Error("result not found");
    expect(result.staged).toBe(3);
    expect(result.unstaged).toBe(0);
    expect(result.untracked).toBe(0);
  });

  test("counts unstaged files (worktree column)", () => {
    const output = " M src/app.ts\n M src/other.ts\n";
    const result = parseStatusPorcelain(output);
    expect(result).not.toBeNull();
    if (!result) throw new Error("result not found");
    expect(result.staged).toBe(0);
    expect(result.unstaged).toBe(2);
    expect(result.untracked).toBe(0);
  });

  test("counts untracked files", () => {
    const output = "?? newfile.ts\n?? another.ts\n";
    const result = parseStatusPorcelain(output);
    expect(result).not.toBeNull();
    if (!result) throw new Error("result not found");
    expect(result.staged).toBe(0);
    expect(result.unstaged).toBe(0);
    expect(result.untracked).toBe(2);
  });

  test("handles mixed staged + unstaged + untracked", () => {
    const output = [
      "M  staged-only.ts",
      " M unstaged-only.ts",
      "MM both.ts", // staged AND unstaged
      "?? newfile.ts",
    ].join("\n");
    const result = parseStatusPorcelain(output);
    expect(result).not.toBeNull();
    if (!result) throw new Error("result not found");
    // "M " = staged, " M" = unstaged, "MM" = both staged+unstaged, "??" = untracked
    expect(result.staged).toBe(2); // M_ and MM
    expect(result.unstaged).toBe(2); // _M and MM
    expect(result.untracked).toBe(1);
  });

  test("returns null when all lines are empty or too short", () => {
    expect(parseStatusPorcelain("\n\n\n")).toBeNull();
    expect(parseStatusPorcelain("X")).toBeNull(); // too short
  });
});

describe("parseDiffTreeOutput", () => {
  test("parses combined raw + numstat output", () => {
    const output = [
      ":100644 100644 abc1234 def5678 M\tsrc/app.tsx",
      ":000000 100644 0000000 abc1234 A\tsrc/new-file.ts",
      ":100644 000000 abc1234 0000000 D\told-file.ts",
      "",
      "12\t3\tsrc/app.tsx",
      "45\t0\tsrc/new-file.ts",
      "0\t10\told-file.ts",
    ].join("\n");

    const files = parseDiffTreeOutput(output);
    expect(files).toHaveLength(3);

    const app = files.find(f => f.path === "src/app.tsx");
    expect(app).toBeDefined();
    if (!app) throw new Error("app not found");
    expect(app.additions).toBe(12);
    expect(app.deletions).toBe(3);
    expect(app.status).toBe("M");

    const newFile = files.find(f => f.path === "src/new-file.ts");
    expect(newFile).toBeDefined();
    if (!newFile) throw new Error("newFile not found");
    expect(newFile.additions).toBe(45);
    expect(newFile.deletions).toBe(0);
    expect(newFile.status).toBe("A");

    const deleted = files.find(f => f.path === "old-file.ts");
    expect(deleted).toBeDefined();
    if (!deleted) throw new Error("deleted not found");
    expect(deleted.additions).toBe(0);
    expect(deleted.deletions).toBe(10);
    expect(deleted.status).toBe("D");
  });

  test("handles rename status (R100)", () => {
    const output = [":100644 100644 abc1234 def5678 R100\told-name.ts\tnew-name.ts", "", "0\t0\told-name.ts"].join(
      "\n",
    );

    const files = parseDiffTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("old-name.ts");
    expect(files[0].status).toBe("R");
  });

  test("handles binary files (- additions/deletions)", () => {
    const output = [":100644 100644 abc1234 def5678 M\timage.png", "", "-\t-\timage.png"].join("\n");

    const files = parseDiffTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("image.png");
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(0);
    expect(files[0].status).toBe("M");
  });

  test("returns empty array for empty output", () => {
    expect(parseDiffTreeOutput("")).toHaveLength(0);
    expect(parseDiffTreeOutput("\n\n")).toHaveLength(0);
  });

  test("defaults to M status when raw line is missing", () => {
    // Only numstat, no raw lines — status should default to "M"
    const output = "5\t2\tsrc/file.ts\n";

    const files = parseDiffTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("M");
  });

  test("handles paths with tabs (pathParts.join)", () => {
    // Pathological case: a path containing a tab character
    const output = "10\t5\tpath\twith\ttabs\n";

    const files = parseDiffTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("path\twith\ttabs");
    expect(files[0].additions).toBe(10);
    expect(files[0].deletions).toBe(5);
  });
});

describe("computeFileWidths", () => {
  test("sums additions and deletions across all files", () => {
    const files = [
      { additions: 10, deletions: 3 },
      { additions: 25, deletions: 7 },
      { additions: 100, deletions: 0 },
    ];
    const result = computeFileWidths(files);
    expect(result.totalAdd).toBe(135);
    expect(result.totalDel).toBe(10);
  });

  test("column widths match formatted total string length", () => {
    const files = [
      { additions: 999, deletions: 50 },
      { additions: 1, deletions: 1 },
    ];
    const result = computeFileWidths(files);
    // totalAdd = 1000, totalDel = 51
    expect(result.totalAdd).toBe(1000);
    expect(result.totalDel).toBe(51);
    // "+1000" = 5 chars, "-51" = 3 chars
    expect(result.addColWidth).toBe(5);
    expect(result.delColWidth).toBe(3);
  });

  test("empty file list returns zeroes with min column width 2", () => {
    const result = computeFileWidths([]);
    expect(result.totalAdd).toBe(0);
    expect(result.totalDel).toBe(0);
    // "+0" = 2 chars, "-0" = 2 chars
    expect(result.addColWidth).toBe(2);
    expect(result.delColWidth).toBe(2);
  });

  test("single file with zero stats", () => {
    const files = [{ additions: 0, deletions: 0 }];
    const result = computeFileWidths(files);
    expect(result.totalAdd).toBe(0);
    expect(result.totalDel).toBe(0);
    expect(result.addColWidth).toBe(2);
    expect(result.delColWidth).toBe(2);
  });
});

describe("resolveRenamePath", () => {
  test("plain path — no braces, returned as-is", () => {
    expect(resolveRenamePath("src/git/repo.ts")).toBe("src/git/repo.ts");
  });

  test("top-level rename {old => new}", () => {
    expect(resolveRenamePath("{old.txt => new.txt}")).toBe("new.txt");
  });

  test("rename within directory dir/{old => new}", () => {
    expect(resolveRenamePath("src/components/dialogs/{operations-dialog.tsx => menu-dialog.tsx}")).toBe(
      "src/components/dialogs/menu-dialog.tsx",
    );
  });

  test("directory move {src/old => dst/new}/file.txt", () => {
    expect(resolveRenamePath("{src/old => dst/new}/file.txt")).toBe("dst/new/file.txt");
  });

  test("move to subdirectory with shared prefix dir/{old.jar => sub/new.jar}", () => {
    expect(
      resolveRenamePath(
        "cicd/{api/openapi-generator-cli-7.9.0.jar => openapi-generator/openapi-generator-cli-7.10.0.jar}",
      ),
    ).toBe("cicd/openapi-generator/openapi-generator-cli-7.10.0.jar");
  });

  test("rename with empty old part { => new}/file (new file added to subdir)", () => {
    expect(resolveRenamePath("{ => src}/file.ts")).toBe("src/file.ts");
  });

  test("rename with empty new part {old => }/file (moved to root)", () => {
    expect(resolveRenamePath("{src => }/file.ts")).toBe("file.ts");
  });
});

describe("parseNumstatOutput", () => {
  test("normal files parsed correctly", () => {
    const stdout = "10\t5\tsrc/app.tsx\n3\t1\tsrc/utils.ts\n";
    const files = parseNumstatOutput(stdout);
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: "src/app.tsx", additions: 10, deletions: 5, status: "M" });
    expect(files[1]).toEqual({ path: "src/utils.ts", additions: 3, deletions: 1, status: "M" });
  });

  test("rename paths resolved to destination", () => {
    const stdout = "5\t5\tsrc/components/dialogs/{operations-dialog.tsx => menu-dialog.tsx}\n";
    const files = parseNumstatOutput(stdout);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/components/dialogs/menu-dialog.tsx");
  });

  test("binary files with - stats parsed as 0", () => {
    const stdout = "-\t-\timage.png\n";
    const files = parseNumstatOutput(stdout);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: "image.png", additions: 0, deletions: 0, status: "M" });
  });

  test("empty input returns empty array", () => {
    expect(parseNumstatOutput("")).toEqual([]);
    expect(parseNumstatOutput("\n")).toEqual([]);
  });
});
