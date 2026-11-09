import { findingIdentity } from "./parser";
import type { SnykFinding } from "./types";

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
