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
    console.log(`  ${String(i).padStart(3)}  ${colStr}  ${bnStr} ${hashStr} ${row.commit.subject}`);
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

  // Also print the graph visually with connector rows
  console.log("\n  Visual graph (with connector rows):");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Commit row
    let line = "  ";
    const maxCol = Math.max(row.columns.length, row.nodeColumn + 1);
    const cmap = new Map<number, string>();
    for (const c of row.connectors) {
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
      const existing = cmap.get(c.column);
      if (!existing || existing === " " || existing === "│") {
        cmap.set(c.column, chars[c.type] ?? "?");
      } else if (c.type === "straight" && existing === "─") {
        cmap.set(c.column, "┼");
      }
    }
    for (let col = 0; col < maxCol; col++) {
      line += (cmap.get(col) ?? " ") + " ";
    }
    line += ` ${row.commit.shortHash} ${row.branchName}`;
    
    // Show raw connectors for rows with tees
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
          connLine += "│ ";
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

// Run all scenarios
analyzeScenario("develop + two sequential feature merges", scenario1());
analyzeScenario("develop + three parallel feature branches (fan-out)", scenario2());
analyzeScenario("renovate-style short branches", scenario3());
analyzeScenario("develop + release + hotfix", scenario4());
analyzeScenario("diamond pattern", scenario5());
analyzeScenario("two long-lived branches with cross-merge", scenario6());
analyzeScenario("release branch far from branch-off (tee vs corner)", scenario7());
