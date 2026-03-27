/**
 * Test: verifies the pure parsing functions in repo.ts.
 *
 * Covers: parseRefs (ref decoration parsing), parseCommitLine (log line parsing),
 * and the RS (record separator) constant.
 *
 * These are unit tests for the parsing layer — they don't spawn git subprocesses.
 */
import { describe, test, expect } from "bun:test";
import { parseRefs, parseCommitLine, parseTagLine, parseTrackInfo, RS } from "../src/git/repo";

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

    const line = [hash, shortHash, parents, refStr, subject, author, email, date, committer, committerEmail, commitDate].join(RS);

    const commit = parseCommitLine(line, new Set(["origin"]));
    expect(commit).not.toBeNull();

    expect(commit!.hash).toBe(hash);
    expect(commit!.shortHash).toBe(shortHash);
    expect(commit!.parents.length).toBe(2);
    expect(commit!.parents[0]).toBe("parent1");
    expect(commit!.parents[1]).toBe("parent2");
    expect(commit!.subject).toBe(subject);
    expect(commit!.body).toBe("");
    expect(commit!.author).toBe(author);
    expect(commit!.authorEmail).toBe(email);
    expect(commit!.authorDate).toBe(date);
    expect(commit!.committer).toBe(committer);
    expect(commit!.committerEmail).toBe(committerEmail);
    expect(commit!.commitDate).toBe(commitDate);

    // Refs
    expect(commit!.refs.length).toBe(2);
    expect(commit!.refs[0].name).toBe("main");
    expect(commit!.refs[0].type).toBe("branch");
    expect(commit!.refs[0].isCurrent).toBe(true);
    expect(commit!.refs[1].name).toBe("v1.0");
    expect(commit!.refs[1].type).toBe("tag");
  });

  test("parseCommitLine — root commit (no parents)", () => {
    const fields = [
      "aaa111", "aaa111", "", "", "Initial commit",
      "Author", "a@b.com", "2024-01-01T00:00:00Z",
      "Author", "a@b.com", "2024-01-01T00:00:00Z",
    ];
    const line = fields.join(RS);

    const commit = parseCommitLine(line, new Set());
    expect(commit).not.toBeNull();
    expect(commit!.parents.length).toBe(0);
    expect(commit!.refs.length).toBe(0);
  });

  test("parseCommitLine — malformed line", () => {
    const result = parseCommitLine("abc" + RS + "def" + RS + "ghi", new Set());
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
      "bbb222", "bbb222", "parent1", "",
      specialSubject,
      "Author", "a@b.com", "2024-06-15T12:00:00Z",
      "Author", "a@b.com", "2024-06-15T12:00:00Z",
    ];
    const line = fields.join(RS);

    const commit = parseCommitLine(line, new Set());
    expect(commit).not.toBeNull();
    expect(commit!.subject).toBe(specialSubject);
  });
});

describe("parseTagLine", () => {
  test("annotated tag with full info", () => {
    const line = [
      "refs/tags/v1.0.0",
      "tag",
      "Jane Doe",
      "2024-06-15T12:00:00+02:00",
      "Release v1.0.0",
    ].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe("v1.0.0");
    expect(tag!.type).toBe("annotated");
    expect(tag!.tagger).toBe("Jane Doe");
    expect(tag!.taggerDate).toBe("2024-06-15T12:00:00+02:00");
    expect(tag!.message).toBe("Release v1.0.0");
  });

  test("lightweight tag", () => {
    const line = [
      "refs/tags/v0.1.0",
      "commit",
      "",
      "",
      "",
    ].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe("v0.1.0");
    expect(tag!.type).toBe("lightweight");
    expect(tag!.tagger).toBeUndefined();
    expect(tag!.taggerDate).toBeUndefined();
    expect(tag!.message).toBeUndefined();
  });

  test("annotated tag with empty tagger/message", () => {
    const line = [
      "refs/tags/v2.0",
      "tag",
      "",
      "",
      "",
    ].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe("v2.0");
    expect(tag!.type).toBe("annotated");
    expect(tag!.tagger).toBeUndefined();
    expect(tag!.taggerDate).toBeUndefined();
    expect(tag!.message).toBeUndefined();
  });

  test("malformed line returns null", () => {
    expect(parseTagLine("")).toBeNull();
    expect(parseTagLine("refs/tags/v1" + RS + "tag")).toBeNull();
  });

  test("strips refs/tags/ prefix from name", () => {
    const line = [
      "refs/tags/release/v3.0",
      "commit",
      "",
      "",
      "",
    ].join(RS);

    const tag = parseTagLine(line);
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe("release/v3.0");
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
