#!/usr/bin/env bun
/**
 * Test script: verifies the pure parsing functions in repo.ts.
 *
 * Covers: parseRefs (ref decoration parsing), parseCommitLine (log line parsing),
 * and the RS (record separator) constant.
 *
 * These are unit tests for the parsing layer — they don't spawn git subprocesses.
 */
import { parseRefs, parseCommitLine, RS } from "../src/git/repo";
import { assert, assertEqual, printResults, runTest } from "./test-helpers";

// ============================================================
// Test 1: parseRefs — empty string
// ============================================================
function test1() {
  console.log("\nTest 1: parseRefs — empty/blank string returns []");

  const refs = parseRefs("", new Set());
  assertEqual(0, refs.length, "empty string returns empty array");

  const refs2 = parseRefs("   ", new Set());
  assertEqual(0, refs2.length, "whitespace-only string returns empty array");
}

// ============================================================
// Test 2: parseRefs — HEAD pointer with branch
// ============================================================
function test2() {
  console.log("\nTest 2: parseRefs — HEAD -> branch");

  const refs = parseRefs("HEAD -> main", new Set(["origin"]));
  assertEqual(1, refs.length, "one ref parsed");
  assertEqual("main", refs[0].name, "branch name is 'main'");
  assertEqual("branch", refs[0].type, "type is branch");
  assert(refs[0].isCurrent, "isCurrent is true for HEAD -> branch");
}

// ============================================================
// Test 3: parseRefs — bare HEAD
// ============================================================
function test3() {
  console.log("\nTest 3: parseRefs — bare HEAD (detached)");

  const refs = parseRefs("HEAD", new Set());
  assertEqual(1, refs.length, "one ref parsed");
  assertEqual("HEAD", refs[0].name, "name is HEAD");
  assertEqual("head", refs[0].type, "type is head");
  assert(refs[0].isCurrent, "isCurrent is true for bare HEAD");
}

// ============================================================
// Test 4: parseRefs — tag
// ============================================================
function test4() {
  console.log("\nTest 4: parseRefs — tag decoration");

  const refs = parseRefs("tag: v1.0.0", new Set());
  assertEqual(1, refs.length, "one ref parsed");
  assertEqual("v1.0.0", refs[0].name, "tag name extracted");
  assertEqual("tag", refs[0].type, "type is tag");
  assert(!refs[0].isCurrent, "tag is not current");
}

// ============================================================
// Test 5: parseRefs — remote branch detection
// ============================================================
function test5() {
  console.log("\nTest 5: parseRefs — remote branch detection");

  const remotes = new Set(["origin", "upstream"]);

  // origin/main should be detected as remote
  const refs1 = parseRefs("origin/main", remotes);
  assertEqual(1, refs1.length, "one ref parsed");
  assertEqual("remote", refs1[0].type, "origin/main is remote");
  assertEqual("origin/main", refs1[0].name, "name preserved");

  // upstream/feature should be detected as remote
  const refs2 = parseRefs("upstream/feature", remotes);
  assertEqual("remote", refs2[0].type, "upstream/feature is remote");

  // refs/remotes/ prefix is also remote regardless of remoteNames
  const refs3 = parseRefs("refs/remotes/origin/main", new Set());
  assertEqual("remote", refs3[0].type, "refs/remotes/ prefix is always remote");
}

// ============================================================
// Test 6: parseRefs — local branch with slash (not remote)
// ============================================================
function test6() {
  console.log("\nTest 6: parseRefs — local branch with slash");

  // feature/my-feature contains "/" but is not prefixed by a known remote
  const refs = parseRefs("feature/my-feature", new Set(["origin"]));
  assertEqual(1, refs.length, "one ref parsed");
  assertEqual("branch", refs[0].type, "feature/my-feature is a local branch");
  assertEqual("feature/my-feature", refs[0].name, "name preserved");
}

// ============================================================
// Test 7: parseRefs — multiple refs (HEAD + branch + remote + tag)
// ============================================================
function test7() {
  console.log("\nTest 7: parseRefs — multiple refs on one commit");

  const refStr = "HEAD -> develop, origin/develop, tag: v2.0";
  const refs = parseRefs(refStr, new Set(["origin"]));
  assertEqual(3, refs.length, "three refs parsed");

  assertEqual("develop", refs[0].name, "first ref is develop");
  assertEqual("branch", refs[0].type, "develop is branch");
  assert(refs[0].isCurrent, "develop is current (HEAD ->)");

  assertEqual("origin/develop", refs[1].name, "second ref is origin/develop");
  assertEqual("remote", refs[1].type, "origin/develop is remote");

  assertEqual("v2.0", refs[2].name, "third ref is v2.0");
  assertEqual("tag", refs[2].type, "v2.0 is tag");
}

// ============================================================
// Test 8: parseCommitLine — valid line
// ============================================================
function test8() {
  console.log("\nTest 8: parseCommitLine — valid line");

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
  assert(commit !== null, "commit is not null");

  assertEqual(hash, commit!.hash, "hash matches");
  assertEqual(shortHash, commit!.shortHash, "shortHash matches");
  assertEqual(2, commit!.parents.length, "two parents");
  assertEqual("parent1", commit!.parents[0], "first parent");
  assertEqual("parent2", commit!.parents[1], "second parent");
  assertEqual(subject, commit!.subject, "subject matches");
  assertEqual("", commit!.body, "body is empty (populated later by getCommitDetail)");
  assertEqual(author, commit!.author, "author matches");
  assertEqual(email, commit!.authorEmail, "authorEmail matches");
  assertEqual(date, commit!.authorDate, "authorDate matches");
  assertEqual(committer, commit!.committer, "committer matches");
  assertEqual(committerEmail, commit!.committerEmail, "committerEmail matches");
  assertEqual(commitDate, commit!.commitDate, "commitDate matches");

  // Refs
  assertEqual(2, commit!.refs.length, "two refs");
  assertEqual("main", commit!.refs[0].name, "first ref is main");
  assertEqual("branch", commit!.refs[0].type, "main is branch");
  assert(commit!.refs[0].isCurrent, "main is current");
  assertEqual("v1.0", commit!.refs[1].name, "second ref is v1.0");
  assertEqual("tag", commit!.refs[1].type, "v1.0 is tag");
}

// ============================================================
// Test 9: parseCommitLine — no parents (root commit)
// ============================================================
function test9() {
  console.log("\nTest 9: parseCommitLine — root commit (no parents)");

  const fields = [
    "aaa111", "aaa111", "", "", "Initial commit",
    "Author", "a@b.com", "2024-01-01T00:00:00Z",
    "Author", "a@b.com", "2024-01-01T00:00:00Z",
  ];
  const line = fields.join(RS);

  const commit = parseCommitLine(line, new Set());
  assert(commit !== null, "commit is not null");
  assertEqual(0, commit!.parents.length, "root commit has no parents");
  assertEqual(0, commit!.refs.length, "no refs");
}

// ============================================================
// Test 10: parseCommitLine — malformed line (too few fields)
// ============================================================
function test10() {
  console.log("\nTest 10: parseCommitLine — malformed line");

  const result = parseCommitLine("abc" + RS + "def" + RS + "ghi", new Set());
  assert(result === null, "returns null for malformed line with < 11 fields");

  const result2 = parseCommitLine("", new Set());
  assert(result2 === null, "returns null for empty string");
}

// ============================================================
// Test 11: RS constant is the ASCII record separator
// ============================================================
function test11() {
  console.log("\nTest 11: RS constant is ASCII 0x1E");

  assertEqual("\x1e", RS, "RS is the ASCII record separator character");
  assertEqual(1, RS.length, "RS is a single character");
  assertEqual(0x1e, RS.charCodeAt(0), "RS char code is 30 (0x1E)");
}

// ============================================================
// Test 12: parseCommitLine — subject with special characters
// ============================================================
function test12() {
  console.log("\nTest 12: parseCommitLine — subject with special characters");

  const specialSubject = "fix(scope): handle <angle> & \"quotes\" + 'apostrophes'";
  const fields = [
    "bbb222", "bbb222", "parent1", "",
    specialSubject,
    "Author", "a@b.com", "2024-06-15T12:00:00Z",
    "Author", "a@b.com", "2024-06-15T12:00:00Z",
  ];
  const line = fields.join(RS);

  const commit = parseCommitLine(line, new Set());
  assert(commit !== null, "commit is not null");
  assertEqual(specialSubject, commit!.subject, "subject with special chars preserved exactly");
}

// ── Run all tests ───────────────────────────────────────────
console.log("=== repo.ts parsing tests ===");

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);
runTest(test6);
runTest(test7);
runTest(test8);
runTest(test9);
runTest(test10);
runTest(test11);
runTest(test12);

printResults("repo-parsing");
