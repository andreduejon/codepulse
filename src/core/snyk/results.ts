/** Which of two scans of a commit to keep. */
import type { SnykScanResult } from "./types";

/**
 * A partial result never replaces a complete one on its own; a rescan the user started does, so the failed projects
 * it names stay visible instead of an older snapshot that may have missed them.
 */
export function shouldReplaceSnykResult(
  existing: SnykScanResult | undefined,
  incoming: SnykScanResult,
  rescan = false,
): boolean {
  if (!existing) return true;
  if (incoming.partial && !existing.partial && !rescan) return false;
  return existing.scannedAt <= incoming.scannedAt;
}
