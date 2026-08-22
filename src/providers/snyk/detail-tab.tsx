import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { formatDate } from "../../utils/date";
import type { SnykFinding, SnykScanResult, SnykSeverity } from "./types";

export interface SnykDetailTabProps {
  /** Exact scan for the selected commit, or null when it has not been scanned. */
  scan: SnykScanResult | null;
  /** Starts a scan for the selected commit. Existing results imply a forced re-scan. */
  onScan: () => void | Promise<void>;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

const SEVERITY_ORDER: Record<SnykSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function severityColor(theme: Theme, severity: SnykSeverity): string {
  switch (severity) {
    case "critical":
      return theme.severityCritical;
    case "high":
      return theme.severityHigh;
    case "medium":
      return theme.severityMedium;
    case "low":
      return theme.severityLow;
  }
}

function compareFindings(a: SnykFinding, b: SnykFinding): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.dependency.localeCompare(b.dependency) ||
    a.title.localeCompare(b.title)
  );
}

export function SnykDetailTab(props: Readonly<SnykDetailTabProps>) {
  const t = useT();
  const scan = () => props.scan;
  const itemRefs: Renderable[] = [];

  const sortedFindings = createMemo(() => [...(scan()?.findings ?? [])].sort(compareFindings));
  const actionLabel = () => (props.loading ? "Scanning..." : scan() ? "Scan again" : "Scan");

  const syncNavRef = () => {
    if (!props.navRef) return;
    props.navRef.itemCount = sortedFindings().length + 1;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = () => {
      if (props.detailCursorIndex() !== 0 || props.loading) return false;
      void props.onScan();
      return false;
    };
  };

  createEffect(() => {
    const itemCount = sortedFindings().length + 1;
    itemRefs.length = itemCount;
    syncNavRef();
    const cursor = props.detailCursorIndex();
    if (cursor < 0 || cursor >= itemCount) props.setDetailCursorIndex(Math.max(0, itemCount - 1));
  });

  createEffect(() => {
    if (!props.detailFocused() || props.detailCursorIndex() !== 0 || props.loading) {
      props.setDetailCursorAction(null);
      return;
    }
    props.setDetailCursorAction(scan() ? "scan again" : "scan");
  });

  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row" width="100%" paddingBottom={1}>
        <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
          Scanned:{" "}
        </text>
        <text flexGrow={1} flexShrink={1} fg={scan() ? t().foreground : t().foregroundMuted} wrapMode="none" truncate>
          {scan() ? formatDate(scan()?.scannedAt ?? "") : "Not scanned"}
        </text>
      </box>

      <box
        ref={(el: Renderable) => {
          itemRefs[0] = el;
          syncNavRef();
        }}
        flexDirection="row"
        width="100%"
        paddingBottom={1}
        backgroundColor={
          props.detailFocused() && props.detailCursorIndex() === 0 ? t().backgroundElementActive : undefined
        }
      >
        <text
          fg={
            props.loading
              ? t().foregroundMuted
              : props.detailFocused() && props.detailCursorIndex() === 0
                ? t().accent
                : t().foreground
          }
          wrapMode="none"
        >
          {`[ ${actionLabel()} ]`}
        </text>
      </box>

      <Show when={props.loading}>
        <text fg={t().accent} wrapMode="none">
          Scanning selected commit...
        </text>
      </Show>

      <box flexDirection="row" width="100%" paddingTop={1} paddingBottom={1}>
        <text flexGrow={1} fg={t().foregroundMuted} wrapMode="none">
          Findings
        </text>
        <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
          {sortedFindings().length}
        </text>
      </box>

      <Show
        when={sortedFindings().length > 0}
        fallback={
          <text fg={t().foregroundMuted} wrapMode="word">
            {scan() ? "No vulnerabilities found" : "Run a scan to check this commit"}
          </text>
        }
      >
        <For each={sortedFindings()}>
          {(finding, index) => {
            const cursorIndex = () => index() + 1;
            const cursored = () => props.detailFocused() && props.detailCursorIndex() === cursorIndex();
            return (
              <box
                ref={(el: Renderable) => {
                  itemRefs[cursorIndex()] = el;
                  syncNavRef();
                }}
                flexDirection="column"
                width="100%"
                paddingBottom={1}
                backgroundColor={cursored() ? t().backgroundElementActive : undefined}
              >
                <box flexDirection="row" width="100%">
                  <text flexShrink={0} width={9} fg={severityColor(t(), finding.severity)} wrapMode="none">
                    <strong>{finding.severity.toUpperCase()}</strong>
                  </text>
                  <text
                    flexGrow={1}
                    flexShrink={1}
                    fg={cursored() ? t().accent : t().foreground}
                    wrapMode="none"
                    truncate
                  >
                    {finding.title}
                  </text>
                </box>
                <box flexDirection="row" width="100%" paddingLeft={2}>
                  <text flexShrink={1} fg={t().foregroundMuted} wrapMode="none" truncate>
                    {`${finding.dependency}@${finding.installedVersion}`}
                  </text>
                  <Show when={finding.fixedVersion}>
                    {version => (
                      <text flexShrink={0} fg={t().success} wrapMode="none">
                        {`  fix ${version()}`}
                      </text>
                    )}
                  </Show>
                </box>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
