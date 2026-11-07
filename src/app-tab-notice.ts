import type { DetailTab, ProviderStatus } from "./context/state";
import { bannerParts } from "./debug/banner";
import type { ProviderView } from "./providers/provider";
import { snykPartialScanNotice, snykProjectNotice } from "./providers/snyk/project-notice";
import type { SnykScanResult } from "./providers/snyk/types";

/**
 * A notice pinned under the detail tabs. The banner over the graph is for "can't work" (errors, missing
 * setup); a tab notice is for "works, but incomplete": provider warnings and per-commit coverage gaps.
 */
export interface TabNotice {
  /** Identity for dismissal: a closed notice stays closed until its key changes. */
  key: string;
  /** Provider warnings clear the provider status when closed; scan notices are remembered by key. */
  fromStatus: boolean;
  kind: "warning" | "info";
  title: string;
  /** Muted lines under the headline. */
  detail: string[];
  /** Labelled lines (path, then reason) after the detail. */
  entries: { label: string; text?: string }[];
  /** Muted line after the entries, such as `+2 more`. */
  footer?: string;
}

/** Warnings go to the tab notice; errors and unavailable stay in the banner over the graph. */
export function isTabNoticeStatus(status: ProviderStatus): boolean {
  return status.kind === "warning";
}

export function tabNoticeFor(input: {
  view: ProviderView;
  /** Display name of the active provider (`OpenShift`), stripped from the headline. */
  source: string;
  status: ProviderStatus;
  tab: DetailTab;
  /** Snyk scan of the selected commit, if any. */
  snykScan: SnykScanResult | null;
}): TabNotice | null {
  if (input.view === "git") return null;
  if (input.status.kind === "warning") {
    const { title, detail } = bannerParts(input.source, input.status.message);
    return {
      key: `status:${input.view}:${input.status.message}`,
      fromStatus: true,
      kind: "warning",
      title,
      detail,
      entries: [],
    };
  }
  const scan = input.snykScan;
  if (input.view !== "snyk" || !scan) return null;
  const notice =
    input.tab === "snyk-deps"
      ? snykProjectNotice(scan.dependencyProjects)
      : input.tab === "snyk"
        ? snykPartialScanNotice(scan)
        : null;
  return notice ? { ...notice, key: `${input.tab}:${scan.sha}:${scan.scannedAt}`, fromStatus: false } : null;
}
