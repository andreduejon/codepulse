import { bannerParts } from "../../core/banner";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderStatus } from "../context/state";

/**
 * A notice pinned at the bottom of the details, under the tab content. The banner over the graph is for "can't
 * work" (errors, missing setup); a tab notice is for "works, but incomplete": provider warnings and per-commit
 * coverage gaps.
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
  /** The provider's own notice for the selected commit and tab (a Snyk scan's coverage gaps), if any. */
  providerNotice: TabNotice | null;
}): TabNotice | null {
  if (input.view === "git" || input.view === "dashboard") return null;
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
  return input.providerNotice;
}
