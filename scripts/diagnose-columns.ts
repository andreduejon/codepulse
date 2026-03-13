#!/usr/bin/env bun
/**
 * Diagnostic script: creates a synthetic git repo with realistic branching,
 * runs buildGraph(), and checks for column jumping.
 *
 * Column jumping = same branch name appearing at different nodeColumn values
 * across rows, without a merge/branch connector explaining the shift.
 */

import { buildGraph } from "../src/git/graph";
import type { Commit } from "../src/git/types";

// Simulate a realistic git history with develop + feature branches
// Commit format mirrors what parseCommitLine produces
function makeCommit(
  hash: string,
  parents: string[],
  refs: { name: string; type: "branch" | "tag" | "remote" | "head"; isCurrent: boolean }[] = [],
  subject = `commit ${hash}`,
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    message: subject,
    subject,
    body: "",
    author: "test",
    authorEmail: "test@test.com",
    authorDate: new Date().toISOString(),
    refs,
  };
}

// ============================================================
// Scenario 1: develop with two feature branches merged in sequence
// Topo-order: feat-B tip, feat-B commits, merge-B, feat-A tip, feat-A commits, merge-A, develop linear
// ============================================================
function scenario1(): Commit[] {
  // Graph should be:
  //   develop: d1 <- d2 <- mergeA <- d3 <- mergeB <- d4 (tip)
  //   feat-A:              mergeA has parent d2 and a1
  //                        a1 <- a2 (a2 is feat-A tip)
  //   feat-B:              mergeB has parent d3 and b1
  //                        b1 <- b2 (b2 is feat-B tip)
  //
  // Topo-order (children first, grouped by branch):
  // d4, mergeB, b2, b1, d3, mergeA, a2, a1, d2, d1

  return [
    makeCommit("d4", ["mergeB"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeB", ["d3", "b2"], [], "Merge feat-B into develop"),
    makeCommit("b2", ["b1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work 2"),
    makeCommit("b1", ["d3"], [], "feat-B work 1"),
    makeCommit("d3", ["mergeA"], [], "develop commit after merge A"),
    makeCommit("mergeA", ["d2", "a2"], [], "Merge feat-A into develop"),
    makeCommit("a2", ["a1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work 2"),
    makeCommit("a1", ["d2"], [], "feat-A work 1"),
    makeCommit("d2", ["d1"], [], "develop commit 2"),
    makeCommit("d1", [], [], "initial commit"),
  ];
}

// ============================================================
// Scenario 2: develop with parallel feature branches (fan-out)
// Three features all branched from the same develop commit
// ============================================================
function scenario2(): Commit[] {
  // develop: d1 <- d2 <- mergeA <- mergeB <- mergeC <- d3 (tip)
  // feat-A: a1 (parent d2)
  // feat-B: b1 (parent d2)
  // feat-C: c1 (parent d2)
  //
  // Topo-order:
  // d3, mergeC, c1, mergeB, b1, mergeA, a1, d2, d1

  return [
    makeCommit("d3", ["mergeC"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip after all merges"),
    makeCommit("mergeC", ["mergeB", "c1"], [], "Merge feat-C into develop"),
    makeCommit("c1", ["d2"], [{ name: "feat-C", type: "branch", isCurrent: false }], "feat-C work"),
    makeCommit("mergeB", ["mergeA", "b1"], [], "Merge feat-B into develop"),
    makeCommit("b1", ["d2"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("mergeA", ["d2", "a1"], [], "Merge feat-A into develop"),
    makeCommit("a1", ["d2"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("d2", ["d1"], [], "develop shared ancestor"),
    makeCommit("d1", [], [], "initial commit"),
  ];
}

// ============================================================
// Scenario 3: renovate-style — many short branches from develop
// that merge back, interleaved
// ============================================================
function scenario3(): Commit[] {
  // develop: d1 <- d2 <- m1 <- m2 <- m3 <- d3 (tip)
  // renovate/a: ra1 (parent d2)
  // renovate/b: rb1 (parent d2)
  // renovate/c: rc1 (parent m1)
  //
  // Topo-order:
  // d3, m3, rc1, m2, rb1, m1, ra1, d2, d1

  return [
    makeCommit("d3", ["m3"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("m3", ["m2", "rc1"], [], "Merge renovate/c"),
    makeCommit("rc1", ["m1"], [{ name: "origin/renovate/c", type: "remote", isCurrent: false }], "renovate/c update"),
    makeCommit("m2", ["m1", "rb1"], [], "Merge renovate/b"),
    makeCommit("rb1", ["d2"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b update"),
    makeCommit("m1", ["d2", "ra1"], [], "Merge renovate/a"),
    makeCommit("ra1", ["d2"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a update"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];
}

// ============================================================
// Scenario 4: long-lived develop with release branch and hotfix
// This tests what happens when develop and release both continue
// ============================================================
function scenario4(): Commit[] {
  // develop: d1 <- d2 <- d3 <- mergeHF <- d4 (tip)
  // release: d2 <- r1 <- mergeHF_rel <- r2 (release tip)
  // hotfix:  d2 <- hf1 (merged into both develop and release)
  //
  // Topo-order (develop is current):
  // d4, mergeHF, hf1, d3, r2, mergeHF_rel, r1, d2, d1
  // (release commits might interleave since they share ancestors)

  return [
    makeCommit("d4", ["mergeHF"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeHF", ["d3", "hf1"], [], "Merge hotfix into develop"),
    makeCommit("hf1", ["d2"], [{ name: "hotfix/fix-1", type: "branch", isCurrent: false }], "hotfix work"),
    makeCommit("d3", ["d2"], [], "develop work after release branch"),
    makeCommit("r2", ["mergeHF_rel"], [{ name: "release/1.0", type: "branch", isCurrent: false }], "release tip"),
    makeCommit("mergeHF_rel", ["r1", "hf1"], [], "Merge hotfix into release"),
    makeCommit("r1", ["d2"], [], "release work"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];
}

function analyzeScenario(name: string, commits: Commit[]) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`SCENARIO: ${name}`);
  console.log("=".repeat(60));

  const rows = buildGraph(commits);

  // Track column per branch name
  const branchColumns = new Map<string, number[]>();

  console.log("\n  Row  Col  Branch           Hash         Subject");
  console.log("  " + "-".repeat(70));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const bn = row.branchName || "(none)";
    const col = row.nodeColumn;

    if (!branchColumns.has(bn)) branchColumns.set(bn, []);
    branchColumns.get(bn)!.push(col);

    const colStr = String(col).padStart(3);
    const bnStr = bn.padEnd(16);
    const hashStr = row.commit.shortHash.padEnd(12);
    const roFlag = row.isRemoteOnly ? " [RO]" : "";
    console.log(`  ${String(i).padStart(3)}  ${colStr}  ${bnStr} ${hashStr} ${row.commit.subject}${roFlag}`);
  }

  // Detect column jumping
  console.log("\n  Column assignment summary:");
  let hasJumps = false;
  for (const [branch, cols] of branchColumns) {
    const uniqueCols = [...new Set(cols)];
    const jumping = uniqueCols.length > 1;
    if (jumping) hasJumps = true;
    const status = jumping ? " *** JUMPING ***" : " OK";
    console.log(`    ${branch.padEnd(20)} columns: [${uniqueCols.join(", ")}]${status}`);
  }

  if (!hasJumps) {
    console.log("  >>> No column jumping detected!");
  } else {
    console.log("  >>> COLUMN JUMPING DETECTED — investigate above");
  }

  // Helper: render a set of connectors to a simple string line
  function renderConnectorsToString(connectors: { type: string; column: number; isRemoteOnly?: boolean; color?: number }[], maxCol: number): string {
    const cmap = new Map<number, string>();
    for (const c of connectors) {
      const chars: Record<string, string> = {
        node: "●",
        straight: "│",
        horizontal: "─",
        "tee-left": "├",
        "tee-right": "┤",
        "corner-top-right": "╮",
        "corner-top-left": "╭",
        "corner-bottom-right": "╯",
        "corner-bottom-left": "╰",
        empty: " ",
      };
      const ch = chars[c.type] ?? "?";
      const existing = cmap.get(c.column);
      if (!existing || existing === " ") {
        cmap.set(c.column, ch);
      } else if (existing === "│" && c.type === "horizontal") {
        // Crossing: vertical + horizontal
        cmap.set(c.column, "┼");
      } else if (existing === "─" && c.type === "straight") {
        // Crossing: horizontal + vertical
        cmap.set(c.column, "┼");
      } else if ((c.type === "corner-bottom-right" || c.type === "corner-top-right") && existing === "─") {
        // Corner + horizontal crossing
        cmap.set(c.column, c.type === "corner-bottom-right" ? "┴" : "┬");
      } else if (existing === "│") {
        // Another connector replaces straight (e.g., corner, tee, node)
        cmap.set(c.column, ch);
      }
    }
    let s = "";
    for (let col = 0; col < maxCol; col++) {
      s += (cmap.get(col) ?? " ") + " ";
    }
    return s;
  }

  // Also print the graph visually with connector rows
  console.log("\n  Visual graph (with connector rows):");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Compute maxCol for this row
    let maxCol = Math.max(row.columns.length, row.nodeColumn + 1);
    // Also account for all connectors (may extend beyond columns after fan-out)
    for (const c of row.connectors) {
      if (c.column + 1 > maxCol) maxCol = c.column + 1;
    }
    // Also account for fan-out rows
    if (row.fanOutRows) {
      for (const foRow of row.fanOutRows) {
        for (const c of foRow) {
          if (c.column + 1 > maxCol) maxCol = c.column + 1;
        }
      }
    }

    // Fan-out rows: render ABOVE the commit row (graph flows bottom-to-top)
    if (row.fanOutRows) {
      for (const foConnectors of row.fanOutRows) {
        let foMaxCol = maxCol;
        for (const c of foConnectors) {
          if (c.column + 1 > foMaxCol) foMaxCol = c.column + 1;
        }
        let foLine = "  " + renderConnectorsToString(foConnectors, foMaxCol);
        // Annotate which lane is closing
        const corner = foConnectors.find(c => c.type === "corner-bottom-right" || c.type === "corner-bottom-left");
        if (corner) {
          foLine += ` (fan-out: lane ${corner.column} closing, color ${corner.color})`;
        }
        console.log(foLine);
      }
    }

    // Commit row
    let line = "  " + renderConnectorsToString(row.connectors, maxCol);
    line += ` ${row.commit.shortHash} ${row.branchName}`;
    if (row.isRemoteOnly) line += " [RO]";
    
    // Show connector remote-only flags for rows that have any
    const hasRemoteOnly = row.connectors.some(c => c.isRemoteOnly);
    if (hasRemoteOnly) {
      const roConns = row.connectors.filter(c => c.isRemoteOnly).map(c => `${c.column}:${c.type}`);
      line += ` {RO: ${roConns.join(", ")}}`;
    }
    const hasTee = row.connectors.some(c => c.type === "tee-left" || c.type === "tee-right");
    if (hasTee) {
      line += `  [${row.connectors.map(c => `${c.column}:${c.type}(c${c.color})`).join(", ")}]`;
    }
    console.log(line);
    
    // Connector row (except for last row)
    if (i < rows.length - 1) {
      let connLine = "  ";
      for (let col = 0; col < row.columns.length; col++) {
        if (row.columns[col].active) {
          connLine += row.columns[col].isRemoteOnly ? "┆ " : "│ ";
        } else {
          connLine += "  ";
        }
      }
      console.log(connLine);
    }
  }
}

// ============================================================
// Scenario 5: feature branch merging into develop, then another
// feature branching from same point (diamond pattern)
// ============================================================
function scenario5(): Commit[] {
  // develop: d1 <- d2 <- mergeA <- mergeB <- d3 (tip)
  // feat-A: d1 <- a1 (merged into d2)
  // feat-B: mergeA <- b1 (merged after A)
  //
  // Topo-order:
  // d3, mergeB, b1, mergeA, a1, d2, d1

  return [
    makeCommit("d3", ["mergeB"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeB", ["mergeA", "b1"], [], "Merge feat-B"),
    makeCommit("b1", ["mergeA"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("mergeA", ["d2", "a1"], [], "Merge feat-A"),
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];
}

// ============================================================
// Scenario 6: two long-lived branches (develop + staging) with
// cross-merges — staging cherry-picks from develop
// ============================================================
function scenario6(): Commit[] {
  // develop: d1 <- d2 <- d3 <- d4 (tip)
  // staging: d1 <- s1 <- merge_d2 <- s2 (tip)
  //   merge_d2 merges d2 into staging
  //
  // Topo-order:
  // d4, d3, d2, s2, merge_d2, s1, d1

  return [
    makeCommit("d4", ["d3"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d3", ["d2"], [], "develop work 3"),
    makeCommit("d2", ["d1"], [], "develop work 2"),
    makeCommit("s2", ["merge_d2"], [{ name: "staging", type: "branch", isCurrent: false }], "staging tip"),
    makeCommit("merge_d2", ["s1", "d2"], [], "Merge develop into staging"),
    makeCommit("s1", ["d1"], [], "staging work"),
    makeCommit("d1", [], [], "initial"),
  ];
}

// ============================================================
// Scenario 7: release branch with multiple commits, branched from develop
// The branch tip is far from the branch-off point (tests tee vs corner)
// ============================================================
function scenario7(): Commit[] {
  // develop: d1 <- d2 <- d3 <- d4 <- d5 (tip, current)
  // release: d2 <- r1 <- r2 <- r3 (release tip)
  //
  // Topo-order:
  // d5, d4, d3, r3, r2, r1, d2, d1

  return [
    makeCommit("d5", ["d4"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d4", ["d3"], [], "develop work 4"),
    makeCommit("d3", ["d2"], [], "develop work 3"),
    makeCommit("r3", ["r2"], [{ name: "release/1.0", type: "branch", isCurrent: false }], "Release v1.46.0"),
    makeCommit("r2", ["r1"], [], "release work 2"),
    makeCommit("r1", ["d2"], [], "release work 1"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];
}

// ============================================================
// Scenario 8: Unmerged remote-only branches above develop
// Simulates origin/renovate/* branches that sit above develop in topo-order
// because they are children of develop's tip. All rows above develop
// should be dimmed (isRemoteOnly=true) including passing-through lane lines.
// ============================================================
function scenario8(): Commit[] {
  // develop: d1 <- d2 <- d3 (tip, current)
  // main: d1 <- d2 <- d3 (same as develop tip, with origin/main + origin/HEAD)
  // origin/renovate/major: d3 <- ren1 (unmerged)
  // origin/renovate/minor: d3 <- ren2 (unmerged)
  // origin/renovate/patch: d3 <- ren3 (unmerged)
  //
  // Topo-order (children first):
  // ren1, ren2, ren3, d3(develop+main+origin/develop+origin/main+origin/HEAD), d2, d1

  return [
    makeCommit("ren1", ["d3"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }], "fix(deps): update major deps"),
    makeCommit("ren2", ["d3"], [{ name: "origin/renovate/minor", type: "remote", isCurrent: false }], "fix(deps): update minor deps"),
    makeCommit("ren3", ["d3"], [{ name: "origin/renovate/patch", type: "remote", isCurrent: false }], "fix(deps): update patch deps"),
    makeCommit("d3", ["d2"], [
      { name: "develop", type: "branch", isCurrent: true },
      { name: "origin/develop", type: "remote", isCurrent: false },
      { name: "v1.52.0", type: "tag", isCurrent: false },
      { name: "main", type: "branch", isCurrent: false },
      { name: "origin/main", type: "remote", isCurrent: false },
      { name: "origin/HEAD", type: "remote", isCurrent: false },
    ], "Merge pull request #36"),
    makeCommit("d2", ["d1"], [], "chore: pipeline changes"),
    makeCommit("d1", [], [], "initial commit"),
  ];
}

// ============================================================
// Scenario 9: e-ant-backend tspd-556/558/626 area
// Complex cross-merges between tspd-556 and tspd-558 branches
// with shared ancestor cee38bbb and tspd-626 side-branch
// ============================================================
function scenario9(): Commit[] {
  // Exact structure from git log --topo-order of e-ant-backend:
  //
  // cd21d4d0 (MR #22 tspd-642) parents: 3c67a4f3, 34ae7c3f
  // 34ae7c3f parents: e9bb1d45  — Update .env.template
  // e9bb1d45 parents: 4f8ea691
  // ...
  // f7e7523b parents: cee38bbb  — chore(tspd-642): config
  // 3c67a4f3 (MR #19 tspd-557) parents: 9b4a4ba2, 0fee6932
  // 0fee6932 parents: 7ffa77a5  — [tspd-557] ESN > time log
  // 9b4a4ba2 (MR #20 tspd-556) parents: d1bbf694, 2cb7d0af
  // 2cb7d0af parents: 3e36e1b3  — feat(tspd-558): minor config fixes
  // 3e36e1b3 parents: c1c4da6a, 34bbc62c — Merge origin/tspd-558 into tspd-556
  // c1c4da6a parents: 5b4a22bb, fe1485f3 — Merge origin/tspd-558 into tspd-556
  // 5b4a22bb parents: 7a4804bc  — feat(tspd-535): sso config
  // 7a4804bc parents: 3f9f7a92  — [tspd-556]- refactor
  // 3f9f7a92 parents: cee38bbb  — [tspd-556]- add a new api
  // d1bbf694 (MR #21 tspd-558) parents: cee38bbb, 34bbc62c
  // 34bbc62c parents: fe1485f3  — [tspd-558]- refactor the code
  // fe1485f3 parents: cee38bbb  — [tspd-556]- LLPs: improved bulk update
  // b95a0262 parents: e5b2a605  — [tspd-626]- added tests
  // e5b2a605 parents: cee38bbb  — [tspd-626]- Functionality to document
  // cee38bbb parents: 8b48362d  — Delete cicd/helm/...
  // 8b48362d parents: 7ffa77a5  — chore(tspd-506): config
  // 7ffa77a5 (MR #18) parents: d7979cd9, aa24bb22
  // aa24bb22 (v1.49.0) parents: c0d70f04

  return [
    // tspd-642 branch
    makeCommit("cd21d4d0", ["3c67a4f3", "34ae7c3f"], [{ name: "develop", type: "branch", isCurrent: true }], "Merge pull request #22 from lht-general/tspd-642"),
    makeCommit("34ae7c3f", ["e9bb1d45"], [], "Update .env.template"),
    makeCommit("e9bb1d45", ["4f8ea691"], [], "fix(tspd-642): etop report s1000d and warnings in sheet"),
    makeCommit("4f8ea691", ["1f4c8531"], [], "fix(tspd-642): remained part of refTaskName"),
    makeCommit("1f4c8531", ["be4f5c69"], [], "feat(tspd-642): refSb handling & warnings in reports"),
    makeCommit("be4f5c69", ["85509b67"], [], "feat(tspd-642): customer s100d task name print option"),
    makeCommit("85509b67", ["f7e7523b"], [], "feat(tspd-642): s100d task name input (engine)"),
    makeCommit("f7e7523b", ["cee38bbb"], [], "chore(tspd-642): config"),
    // Merge #19 tspd-557
    makeCommit("3c67a4f3", ["9b4a4ba2", "0fee6932"], [], "Merge pull request #19 from lht-general/tspd-557"),
    makeCommit("0fee6932", ["7ffa77a5"], [], "[tspd-557] - ESN > time log / LLPs: automatically synchronize ratings used"),
    // Merge #20 tspd-556
    makeCommit("9b4a4ba2", ["d1bbf694", "2cb7d0af"], [], "Merge pull request #20 from lht-general/tspd-556"),
    makeCommit("2cb7d0af", ["3e36e1b3"], [], "feat(tspd-558): minor config fixes"),
    makeCommit("3e36e1b3", ["c1c4da6a", "34bbc62c"], [], "Merge remote-tracking branch 'origin/tspd-558' into tspd-556"),
    makeCommit("c1c4da6a", ["5b4a22bb", "fe1485f3"], [], "Merge remote-tracking branch 'origin/tspd-558' into tspd-556"),
    makeCommit("5b4a22bb", ["7a4804bc"], [], "feat(tspd-535): sso config"),
    makeCommit("7a4804bc", ["3f9f7a92"], [], "[tspd-556]- refactor"),
    makeCommit("3f9f7a92", ["cee38bbb"], [], "[tspd-556]- add a new api for calculating the @install values"),
    // Merge #21 tspd-558
    makeCommit("d1bbf694", ["cee38bbb", "34bbc62c"], [], "Merge pull request #21 from lht-general/tspd-558"),
    makeCommit("34bbc62c", ["fe1485f3"], [], "[tspd-558]- refactor the code"),
    makeCommit("fe1485f3", ["cee38bbb"], [], "[tspd-556]- LLPs: improved bulk update of part / LLP times & cycles"),
    // tspd-626 branch
    makeCommit("b95a0262", ["e5b2a605"], [{ name: "origin/tspd-626", type: "remote", isCurrent: false }], "[tspd-626]- added tests for ticket tspd-626"),
    makeCommit("e5b2a605", ["cee38bbb"], [], "[tspd-626]- Functionality to document 'penalty cycles'"),
    // shared ancestor
    makeCommit("cee38bbb", ["8b48362d"], [], "Delete cicd/helm/e-ant-backend/values.tspd-506.yaml"),
    makeCommit("8b48362d", ["7ffa77a5"], [], "chore(tspd-506): config"),
    // Merge #18
    makeCommit("7ffa77a5", ["d7979cd9", "aa24bb22"], [], "Merge pull request #18 from lht-general/main"),
    makeCommit("aa24bb22", ["c0d70f04"], [{ name: "v1.49.0", type: "tag", isCurrent: false }], "Release v1.49.0"),
    makeCommit("c0d70f04", ["d7979cd9"], [], "Merge pull request #17 from lht-general/develop"),
    makeCommit("d7979cd9", [], [], "initial"),
  ];
}

// Run all scenarios
analyzeScenario("develop + two sequential feature merges", scenario1());
analyzeScenario("develop + three parallel feature branches (fan-out)", scenario2());
analyzeScenario("renovate-style short branches", scenario3());
analyzeScenario("develop + release + hotfix", scenario4());
analyzeScenario("diamond pattern", scenario5());
analyzeScenario("two long-lived branches with cross-merge", scenario6());
analyzeScenario("release branch far from branch-off (tee vs corner)", scenario7());
analyzeScenario("unmerged remote-only branches above develop", scenario8());
analyzeScenario("e-ant-backend tspd-556/558/626 area", scenario9());
