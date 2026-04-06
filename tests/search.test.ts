import { describe, expect, test } from "bun:test";
import { computeTwoZoneRows } from "../src/context/state";
import type { GraphRow } from "../src/git/types";
import { matchCommit, parseSearchQuery } from "../src/search";
import { makeCommit } from "./test-helpers";

// ─── parseSearchQuery ────────────────────────────────────────────────

describe("parseSearchQuery", () => {
  test("empty string returns substring mode with empty query", () => {
    const result = parseSearchQuery("");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("");
    expect(result.regex).toBeNull();
  });

  test("whitespace-only string returns substring mode with empty query", () => {
    const result = parseSearchQuery("   ");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("");
    expect(result.regex).toBeNull();
  });

  test("plain text returns substring mode with lowercased query", () => {
    const result = parseSearchQuery("Fix Bug");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("fix bug");
    expect(result.regex).toBeNull();
  });

  test("/pattern/ returns regex mode with compiled regex", () => {
    const result = parseSearchQuery("/fix.*bug/");
    expect(result.mode).toBe("regex");
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.regex?.source).toBe("fix.*bug");
    expect(result.regex?.flags).toContain("i");
  });

  test("regex is case-insensitive", () => {
    const result = parseSearchQuery("/FIX/");
    expect(result.regex?.test("fix")).toBe(true);
    expect(result.regex?.test("FIX")).toBe(true);
    expect(result.regex?.test("Fix")).toBe(true);
  });

  test("invalid regex falls back to substring mode", () => {
    const result = parseSearchQuery("/[invalid(/");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("/[invalid(/");
    expect(result.regex).toBeNull();
  });

  test("single slash is treated as substring", () => {
    const result = parseSearchQuery("/");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("/");
    expect(result.regex).toBeNull();
  });

  test("two slashes with nothing between is treated as substring (//)", () => {
    const result = parseSearchQuery("//");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("//");
    expect(result.regex).toBeNull();
  });

  test("leading slash without trailing slash is substring", () => {
    const result = parseSearchQuery("/partial");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("/partial");
    expect(result.regex).toBeNull();
  });

  test("trailing slash without leading slash is substring", () => {
    const result = parseSearchQuery("partial/");
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe("partial/");
    expect(result.regex).toBeNull();
  });

  test("preserves raw query string", () => {
    const result = parseSearchQuery("/fix.*bug/");
    expect(result.raw).toBe("/fix.*bug/");
  });

  test("regex with special characters compiles correctly", () => {
    const result = parseSearchQuery("/^feat\\(.*\\):/");
    expect(result.mode).toBe("regex");
    expect(result.regex?.test("feat(core): add search")).toBe(true);
    expect(result.regex?.test("fix: something")).toBe(false);
  });

  test("regex with alternation works", () => {
    const result = parseSearchQuery("/fix|feat|refactor/");
    expect(result.mode).toBe("regex");
    expect(result.regex?.test("fix: bug")).toBe(true);
    expect(result.regex?.test("feat: new")).toBe(true);
    expect(result.regex?.test("refactor: cleanup")).toBe(true);
    expect(result.regex?.test("docs: update")).toBe(false);
  });

  test("whitespace around /pattern/ is trimmed before detection", () => {
    const result = parseSearchQuery("  /fix/  ");
    expect(result.mode).toBe("regex");
    expect(result.regex?.source).toBe("fix");
  });
});

// ─── matchCommit ─────────────────────────────────────────────────────

describe("matchCommit", () => {
  const commit = makeCommit(
    "abc1234567890",
    ["def456"],
    [
      { name: "main", type: "head", isCurrent: true },
      { name: "origin/main", type: "remote", isCurrent: false },
    ],
    "feat: add search functionality",
  );
  // Override author for deterministic tests
  (commit as { author: string }).author = "Jane Doe";

  test("empty query matches everything", () => {
    const search = parseSearchQuery("");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("substring matches subject (case-insensitive)", () => {
    const search = parseSearchQuery("SEARCH");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("substring matches author", () => {
    const search = parseSearchQuery("jane");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("substring matches shortHash", () => {
    const search = parseSearchQuery("abc1234");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("substring matches ref name", () => {
    const search = parseSearchQuery("origin/main");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("substring does not match body or full hash", () => {
    // Full hash beyond shortHash should not match
    const search = parseSearchQuery("567890");
    expect(matchCommit(commit, search)).toBe(false);
  });

  test("regex matches subject", () => {
    const search = parseSearchQuery("/^feat:/");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("regex does not match when pattern fails", () => {
    const search = parseSearchQuery("/^fix:/");
    expect(matchCommit(commit, search)).toBe(false);
  });

  test("regex matches author", () => {
    const search = parseSearchQuery("/jane.*doe/");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("regex matches ref name", () => {
    const search = parseSearchQuery("/origin\\/main/");
    expect(matchCommit(commit, search)).toBe(true);
  });

  test("invalid regex falls back to substring and still matches", () => {
    // "[invalid(" is not valid regex — should fall back to substring
    // and match because the commit has no such text
    const search = parseSearchQuery("/[invalid(/");
    expect(search.mode).toBe("substring");
    expect(matchCommit(commit, search)).toBe(false);
  });

  test("matches commit with no refs via subject", () => {
    const noRefsCommit = makeCommit("bbb0000000000", [], [], "chore: update deps");
    (noRefsCommit as { author: string }).author = "Bob";
    const search = parseSearchQuery("update deps");
    expect(matchCommit(noRefsCommit, search)).toBe(true);
  });

  test("regex with capture group works", () => {
    const search = parseSearchQuery("/(feat|fix):/");
    expect(matchCommit(commit, search)).toBe(true);
  });
});

// ─── Two-zone row computation (Phase 1 context window) ───────────────

/**
 * Build a minimal GraphRow for state.ts tests. Only `commit` fields
 * are needed — the two-zone logic only reads `commit.hash`.
 * Other fields are stubbed.
 */
function makeGraphRow(hash: string, subject: string): GraphRow {
  return {
    commit: makeCommit(hash, [], [], subject),
    columns: [],
    nodeColumn: 0,
    connectors: [],
    isOnCurrentBranch: false,
    nodeColor: 0,
    branchName: "main",
    parentHashes: [],
    parentBranches: [],
    parentColors: [],
    children: [],
    childBranches: [],
    childColors: [],
    isRemoteOnly: false,
    remoteOnlyBranches: new Set(),
  };
}

/** Filter rows by search query, mirroring searchMatchRows memo. */
function filterMatches(rows: GraphRow[], query: string): GraphRow[] {
  const parsed = parseSearchQuery(query);
  return rows.filter(row => matchCommit(row.commit, parsed));
}

describe("computeTwoZoneRows", () => {
  test("anchor first, then all matches in graph order", () => {
    // Graph order: aaa, bbb(cursor), ccc(feat), ddd(feat)
    const rows = [
      makeGraphRow("aaa", "chore: cursor"),
      makeGraphRow("bbb", "feat: first"),
      makeGraphRow("ccc", "feat: second"),
    ];
    const matches = filterMatches(rows, "feat");
    const anchorRow = rows[0]; // aaa

    const result = computeTwoZoneRows(matches, anchorRow);

    // Two zones: [aaa(anchor)] then [bbb, ccc(matches)]
    expect(result.length).toBe(3);
    expect(result[0].commit.hash).toBe("aaa");
    expect(result[1].commit.hash).toBe("bbb");
    expect(result[2].commit.hash).toBe("ccc");
  });

  test("anchor itself matches — not duplicated", () => {
    const rows = [
      makeGraphRow("aaa", "feat: anchor and match"),
      makeGraphRow("bbb", "feat: second"),
      makeGraphRow("ccc", "chore: unrelated"),
    ];
    const matches = filterMatches(rows, "feat");
    const anchorRow = rows[0]; // aaa matches too

    const result = computeTwoZoneRows(matches, anchorRow);

    // aaa appears once as anchor; bbb below it
    expect(result.length).toBe(2);
    expect(result[0].commit.hash).toBe("aaa");
    expect(result[1].commit.hash).toBe("bbb");
  });

  test("anchor in the middle — matches before and after both go below", () => {
    const rows = [
      makeGraphRow("aaa", "feat: first"),
      makeGraphRow("bbb", "chore: cursor"),
      makeGraphRow("ccc", "feat: second"),
    ];
    const matches = filterMatches(rows, "feat");
    const anchorRow = rows[1]; // bbb

    const result = computeTwoZoneRows(matches, anchorRow);

    // anchor first, then matches in their original graph order
    expect(result.length).toBe(3);
    expect(result[0].commit.hash).toBe("bbb");
    expect(result[1].commit.hash).toBe("aaa");
    expect(result[2].commit.hash).toBe("ccc");
  });

  test("no matches — only anchor row", () => {
    const rows = [makeGraphRow("aaa", "feat: add login"), makeGraphRow("bbb", "fix: typo")];
    const matches = filterMatches(rows, "zzzznotfound");
    const anchorRow = rows[1]; // bbb

    const result = computeTwoZoneRows(matches, anchorRow);

    expect(result.length).toBe(1);
    expect(result[0].commit.hash).toBe("bbb");
  });

  test("no anchor — just the matches list", () => {
    const rows = [
      makeGraphRow("aaa", "feat: add login"),
      makeGraphRow("bbb", "fix: typo"),
      makeGraphRow("ccc", "feat: add signup"),
    ];
    const matches = filterMatches(rows, "feat");

    const result = computeTwoZoneRows(matches, null);

    expect(result.length).toBe(2);
    expect(result[0].commit.hash).toBe("aaa");
    expect(result[1].commit.hash).toBe("ccc");
  });

  test("regex search works", () => {
    const rows = [
      makeGraphRow("aaa", "feat: add login"),
      makeGraphRow("bbb", "chore: cleanup"),
      makeGraphRow("ccc", "fix: auth bug"),
      makeGraphRow("ddd", "feat: dashboard"),
    ];
    const parsed = parseSearchQuery("/^feat:/");
    const matches = rows.filter(row => matchCommit(row.commit, parsed));
    const anchorRow = rows[1]; // bbb (chore, doesn't match)

    const result = computeTwoZoneRows(matches, anchorRow);

    // anchor first, then aaa and ddd (graph order)
    expect(result.length).toBe(3);
    expect(result[0].commit.hash).toBe("bbb");
    expect(result[1].commit.hash).toBe("aaa");
    expect(result[2].commit.hash).toBe("ddd");
  });

  test("empty matches and no anchor — empty result", () => {
    const result = computeTwoZoneRows([], null);
    expect(result.length).toBe(0);
  });

  test("empty matches with anchor — only anchor", () => {
    const rows = [makeGraphRow("aaa", "feat: add login")];
    const result = computeTwoZoneRows([], rows[0]);
    expect(result.length).toBe(1);
    expect(result[0].commit.hash).toBe("aaa");
  });

  test("anchor at end of graph — matches above still appear below it in list", () => {
    const rows = [
      makeGraphRow("aaa", "feat: first"),
      makeGraphRow("bbb", "feat: second"),
      makeGraphRow("ccc", "chore: anchor at end"),
    ];
    const matches = filterMatches(rows, "feat");
    const anchorRow = rows[2]; // ccc

    const result = computeTwoZoneRows(matches, anchorRow);

    expect(result.length).toBe(3);
    expect(result[0].commit.hash).toBe("ccc"); // anchor first
    expect(result[1].commit.hash).toBe("aaa"); // then matches in original order
    expect(result[2].commit.hash).toBe("bbb");
  });
});
