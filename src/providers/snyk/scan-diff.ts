import { findingIdentity } from "./parser";
import type { SnykFinding, SnykScanResult } from "./types";

/** A vulnerability in a package, whatever its version: a bump that keeps it vulnerable is not a change. */
export const diffKey = (finding: SnykFinding) => `${findingIdentity(finding)}:${finding.dependency}`;

/**
 * What a commit changed against its parent's scan: the findings it added (marked `new`), and the parent's findings
 * it no longer has (listed as fixed).
 */
export function diffSnykScans(
  findings: readonly SnykFinding[],
  parentFindings: readonly SnykFinding[],
): { added: Set<SnykFinding>; fixed: SnykFinding[] } {
  const before = new Set(parentFindings.map(diffKey));
  const after = new Set(findings.map(diffKey));
  return {
    added: new Set(findings.filter(finding => !before.has(diffKey(finding)))),
    fixed: parentFindings.filter(finding => !after.has(diffKey(finding))),
  };
}

/** The scan NEW and FIXED compare with, and how many first-parent steps back its commit is. */
export interface SnykBaseline {
  sha: string;
  scan: SnykScanResult;
  stepsBack: number;
}

/**
 * The first parent's scan, or else the nearest scanned commit further down the first-parent line, so a commit still
 * compares when its parent was never scanned. `null` when nothing below it has a scan.
 */
export function findSnykBaseline(
  sha: string,
  firstParentOf: (sha: string) => string | undefined,
  scanOf: (sha: string) => SnykScanResult | null | undefined,
): SnykBaseline | null {
  let stepsBack = 0;
  for (let current = firstParentOf(sha); current; current = firstParentOf(current)) {
    stepsBack++;
    const scan = scanOf(current);
    if (scan) return { sha: current, scan, stepsBack };
  }
  return null;
}

/** `vs parent 4c5d6e7`, or `vs 1a2b3c4, 3 commits back`. */
export function snykBaselineNote(baseline: SnykBaseline): string {
  const short = baseline.sha.slice(0, 7);
  return baseline.stepsBack === 1 ? `vs parent ${short}` : `vs ${short}, ${baseline.stepsBack} commits back`;
}
