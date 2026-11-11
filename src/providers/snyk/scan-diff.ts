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

/**
 * The projects a scan could not resolve, by target file; null when it failed somewhere it did not name, so nothing
 * it found or missed can be trusted for a comparison.
 */
function failedTargets(scan: SnykScanResult): Set<string> | null {
  if (!scan.partial) return new Set();
  const named = scan.failedTargets ?? [];
  return named.length >= (scan.failedProjects ?? 1) ? new Set(named) : null;
}

/**
 * Like `diffSnykScans`, for two whole scans. A project either scan could not resolve is left out on both sides: its
 * findings are neither fixed (they were not looked for) nor new. Null when a partial scan does not say which
 * projects failed.
 */
export function compareSnykScans(
  scan: SnykScanResult,
  parent: SnykScanResult,
): { added: Set<SnykFinding>; fixed: SnykFinding[] } | null {
  const here = failedTargets(scan);
  const there = failedTargets(parent);
  if (!here || !there) return null;
  const compared = (finding: SnykFinding) =>
    finding.targetFile === null || (!here.has(finding.targetFile) && !there.has(finding.targetFile));
  return diffSnykScans(scan.findings.filter(compared), parent.findings.filter(compared));
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
