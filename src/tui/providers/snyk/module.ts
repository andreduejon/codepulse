/** Snyk as a provider module: it scans branch tips on its own, so it has nothing to fetch again on Reload. */
import { snykProvider } from "../../../core/snyk/definition";
import type { SnykScanResult } from "../../../core/snyk/types";
import type { TabNotice } from "../../app/app-tab-notice";
import { severityColor } from "../../utils/severity";
import { providerModule } from "../module";
import { type SnykDetailSource, snykDependenciesDetail, snykVulnerabilitiesDetail } from "./detail-entry";
import { snykGraphColumns } from "./graph-columns";
import { SNYK_HELP } from "./help";
import { SNYK_SEVERITY_LEGEND } from "./legend";
import { buildSnykProviderItems } from "./menu-items";
import { snykPartialScanNotice, snykProjectNotice } from "./project-notice";
import { useSnyk } from "./use-snyk";

const DEPENDENCIES_TAB = "snyk-deps";

/** What a scan left out, or which projects it couldn't read: under the tab that shows them. */
export function snykTabNotice(scan: SnykScanResult | null, tab: string): TabNotice | null {
  if (!scan) return null;
  const notice =
    tab === DEPENDENCIES_TAB
      ? snykProjectNotice(scan.dependencyProjects)
      : tab === snykProvider.id
        ? snykPartialScanNotice(scan)
        : null;
  return notice ? { ...notice, key: `${tab}:${scan.sha}:${scan.scannedAt}`, fromStatus: false } : null;
}

export const snykModule = providerModule({
  definition: snykProvider,
  start: ({ state, actions, settings, suspended, adapters }) => {
    const snyk = useSnyk({ state, actions, config: settings, suspended, adapters });
    const detailSource: SnykDetailSource = {
      getCommitData: snyk.getCommitData,
      isScanning: snyk.isScanning,
      scanCommit: snyk.scanCommit,
      get status() {
        return state.providerStatusFor(snykProvider.id);
      },
    };
    return {
      instance: snyk,
      getCommitData: snyk.getCommitData,
      invalidate: snyk.invalidate,
      detailSource,
      graphColumns: snykGraphColumns(snyk),
      // A scan that failed in another view must not pass silently.
      backgroundError: () => {
        const message = snyk.backgroundError();
        return message ? { message, dismiss: snyk.dismissBackgroundError } : null;
      },
      tabNotice: (sha, tab) => snykTabNotice(snyk.getCommitData(sha), tab),
      // Its tab shows the event's scan: read it from the cache when the graph holds it not.
      onDashboardSelect: event => void snyk.readCachedScan(event.sha),
    };
  },
  colors: theme => ({ bg: theme.snykBg, fg: theme.snykFg }),
  menuItems: menu =>
    buildSnykProviderItems(
      menu.settings,
      menu.state.branches,
      undefined,
      menu.update,
      menu.lastRefresh,
      menu.tokenIsSet,
    ),
  detailEntries: { [snykProvider.id]: snykVulnerabilitiesDetail, [DEPENDENCIES_TAB]: snykDependenciesDetail },
  help: SNYK_HELP,
  legend: SNYK_SEVERITY_LEGEND,
  // A scan's mark is its worst finding's severity; a clean scan has none.
  eventMark: event => {
    const severity = event.severity;
    return severity ? { icon: "▲", color: theme => severityColor(theme, severity) } : null;
  },
});
