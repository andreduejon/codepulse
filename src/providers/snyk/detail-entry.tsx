import { createMemo } from "solid-js";
import { useAppState } from "../../context/state";
import { type DetailEntryContext, detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { DEPENDENCY_LEGEND, SnykDependenciesTab } from "./deps-tab";
import { SnykDetailTab } from "./detail-tab";
import { findSnykBaseline } from "./scan-diff";
import type { SnykScanResult } from "./types";
import type { SnykViewMemory } from "./view-memory";
import { VULNERABILITY_LEGEND } from "./vulnerabilities-model";

/** What Snyk hands the detail view; its Vulnerabilities and Dependencies tabs share it. */
export interface SnykDetailSource extends ProviderDetailSource<SnykScanResult> {
  isScanning?: (sha: string) => boolean;
  scanCommit: (sha: string, force?: boolean) => Promise<SnykScanResult | null>;
}

interface SnykTabProps {
  source: SnykDetailSource;
  context: DetailEntryContext;
}

/** What both Snyk tabs share: the scan, Scan, the view memory across tab switches, and the cursor. */
function snykTabProps(props: SnykTabProps) {
  const memory = props.context.memory("snyk", (): SnykViewMemory => ({}));
  return {
    memory,
    get mouseEnabled() {
      return props.context.mouseEnabled;
    },
    get onMouseFocus() {
      return props.context.onMouseFocus;
    },
    get scan() {
      return props.source.getCommitData(props.context.sha) ?? null;
    },
    get contentWidth() {
      return props.context.contentWidth;
    },
    onScan: async () => {
      await props.source.scanCommit(props.context.sha, !!props.source.getCommitData(props.context.sha));
    },
    get loading() {
      return props.source.isScanning?.(props.context.sha) ?? false;
    },
    /** Like the CI and OpenShift Reload rows, Scan is muted and skipped while Snyk cannot work. */
    get unavailable() {
      return props.context.unavailable("snyk", props.source.status) !== null;
    },
    ...props.context.cursor,
  };
}

function VulnerabilitiesTab(props: SnykTabProps) {
  const { state, actions } = useAppState();
  /** First parent of each loaded commit, to walk back to the nearest scanned one. */
  const firstParents = createMemo(
    () => new Map(state.graphRows().map(row => [row.commit.hash, row.commit.parents[0]] as const)),
  );
  /** The scan Vulnerabilities compares with: the first parent's, or the nearest scanned commit further back. */
  const baseline = () =>
    findSnykBaseline(
      props.context.sha,
      sha => firstParents().get(sha),
      sha => props.source.getCommitData(sha),
    );
  return (
    <SnykDetailTab
      {...snykTabProps(props)}
      active={() => state.detailActiveTab() === "snyk"}
      takePendingFilter={() => {
        const query = state.snykPendingFilter();
        actions.setSnykPendingFilter(null);
        return query;
      }}
      baseline={baseline()}
    />
  );
}

function DependenciesTab(props: SnykTabProps) {
  const { state, actions } = useAppState();
  return (
    <SnykDependenciesTab
      {...snykTabProps(props)}
      setDetailCursorShortcut={shortcut => props.context.cursor.setDetailCursorShortcut?.(shortcut)}
      active={() => state.detailActiveTab() === "snyk-deps"}
      onShowVulnerabilities={query => {
        actions.setSnykPendingFilter(query);
        actions.setDetailCursorAction(null);
        actions.setDetailActiveTab("snyk");
        actions.setDetailCursorIndex(0);
      }}
    />
  );
}

const hasFindings = (source: SnykDetailSource, sha: string) => (source.getCommitData(sha)?.findings.length ?? 0) > 0;

export const snykVulnerabilitiesDetail = detailEntry({
  view: "snyk",
  Tab: VulnerabilitiesTab,
  legend: (source, sha) => (hasFindings(source, sha) ? VULNERABILITY_LEGEND : null),
});

export const snykDependenciesDetail = detailEntry({
  view: "snyk",
  Tab: DependenciesTab,
  legend: (source, sha) => (hasFindings(source, sha) ? DEPENDENCY_LEGEND : null),
});
