import type { Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../../constants";
import type { Theme } from "../../context/theme";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import type { SnykFinding, SnykScanResult, SnykSeverity } from "./types";

export interface SnykDetailTabProps {
  scan: SnykScanResult | null;
  onScan: () => void | Promise<void>;
  contentWidth?: number;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

const SEVERITIES: SnykSeverity[] = ["critical", "high", "medium", "low"];
const MIN_PANEL_WIDTH = 60;
const PANEL_PADDING_X = 4;
const FINDING_PREFIX_WIDTH = 8;
const METADATA_PREFIX_WIDTH = 9;
type SeverityGroup = { severity: SnykSeverity; findings: SnykFinding[] };
type FlatItem =
  | { kind: "scan" }
  | { kind: "severity"; severity: SnykSeverity }
  | { kind: "finding"; severity: SnykSeverity; finding: SnykFinding; occurrence: number };

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

function compareFindings(left: SnykFinding, right: SnykFinding): number {
  return left.title.localeCompare(right.title) || left.dependency.localeCompare(right.dependency);
}

function itemKey(item: FlatItem): string {
  if (item.kind === "scan") return "scan";
  return item.kind === "severity" ? `severity:${item.severity}` : `finding:${item.severity}:${item.occurrence}`;
}

function wrapWords(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.flatMap(entry => {
    if (entry.length <= width) return [entry];
    const chunks: string[] = [];
    for (let offset = 0; offset < entry.length; offset += width) chunks.push(entry.slice(offset, offset + width));
    return chunks;
  });
}

function compactDependencyName(value: string): string {
  const separator = value.lastIndexOf(":");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function dependencyVersion(path: string[] | undefined, dependency: string): string | null {
  const prefix = `${dependency}@`;
  const match = path?.find(entry => entry.startsWith(prefix));
  return match?.slice(prefix.length) || null;
}

export function SnykDetailTab(props: Readonly<SnykDetailTabProps>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const [expandedSeverities, setExpandedSeverities] = createSignal<Set<SnykSeverity>>(new Set(SEVERITIES));
  const [expandedFindings, setExpandedFindings] = createSignal<Set<string>>(new Set());
  const refsByKey = new Map<string, Renderable>();
  const itemRefs: Renderable[] = [];

  const groups = createMemo<SeverityGroup[]>(() =>
    props.scan
      ? SEVERITIES.map(severity => {
          const findings = (props.scan?.findings ?? [])
            .filter(finding => finding.severity === severity)
            .sort(compareFindings);
          return { severity, findings };
        })
      : [],
  );

  const flatItems = createMemo<FlatItem[]>(() => [
    { kind: "scan" as const },
    ...groups().flatMap(group =>
      group.findings.length === 0
        ? []
        : [
            { kind: "severity" as const, severity: group.severity },
            ...(expandedSeverities().has(group.severity)
              ? group.findings.map(finding => ({
                  kind: "finding" as const,
                  severity: group.severity,
                  finding,
                  occurrence: props.scan?.findings.indexOf(finding) ?? -1,
                }))
              : []),
          ],
    ),
  ]);

  const panelUsableWidth = () =>
    Math.max(
      1,
      props.contentWidth ??
        Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X,
    );
  const findingLabelWidth = () => Math.max(1, panelUsableWidth() - FINDING_PREFIX_WIDTH);
  const metadataWidth = () => Math.max(10, panelUsableWidth() - METADATA_PREFIX_WIDTH);
  const selectedFinding = createMemo(() => {
    if (!props.detailFocused()) return null;
    const item = flatItems()[props.detailCursorIndex()];
    return item?.kind === "finding" ? item.finding : null;
  });
  const findingLabel = (finding: SnykFinding) => `${finding.dependency}@${finding.installedVersion}`;
  const bannerOverflow = createMemo(() =>
    Math.max(0, (selectedFinding() ? findingLabel(selectedFinding() as SnykFinding).length : 0) - findingLabelWidth()),
  );
  const scanIdentity = createMemo(() => (props.scan ? `${props.scan.sha}:${props.scan.scannedAt}` : ""));
  const bannerOffset = useBannerScroll(bannerOverflow);

  const syncRefs = () => {
    const items = flatItems();
    itemRefs.length = items.length;
    items.forEach((item, index) => {
      const ref = refsByKey.get(itemKey(item));
      if (ref) itemRefs[index] = ref;
    });
    if (props.navRef) props.navRef.itemRefs = itemRefs;
  };

  const toggleSeverity = (severity: SnykSeverity) => {
    setExpandedSeverities(previous => {
      const next = new Set(previous);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  const toggleFinding = (finding: SnykFinding) => {
    const key = itemKey({
      kind: "finding",
      severity: finding.severity,
      finding,
      occurrence: props.scan?.findings.indexOf(finding) ?? -1,
    });
    setExpandedFindings(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  createEffect(() => {
    scanIdentity();
    setExpandedSeverities(
      new Set(
        groups()
          .filter(group => group.findings.length > 0)
          .map(group => group.severity),
      ),
    );
    setExpandedFindings(new Set<string>());
    props.setDetailCursorIndex(0);
  });

  createEffect(() => {
    const count = flatItems().length;
    const cursor = untrack(() => props.detailCursorIndex());
    if (count === 0) props.setDetailCursorIndex(0);
    else if (cursor < 0 || cursor >= count) props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  createEffect(() => {
    const items = flatItems();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    syncRefs();
    props.navRef.activateCurrentItem = () => {
      const item = flatItems()[props.detailCursorIndex()];
      if (!item) return false;
      if (item.kind === "scan") {
        if (!props.loading) void props.onScan();
      } else if (item.kind === "severity") toggleSeverity(item.severity);
      else toggleFinding(item.finding);
      return false;
    };
  });

  createEffect(() => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!props.detailFocused() || !item) {
      props.setDetailCursorAction(null);
      return;
    }
    if (item.kind === "scan") {
      props.setDetailCursorAction(props.loading ? null : "scan");
      return;
    }
    const expanded =
      item.kind === "severity" ? expandedSeverities().has(item.severity) : expandedFindings().has(itemKey(item));
    props.setDetailCursorAction(expanded ? "collapse" : "expand");
  });

  return (
    <box flexDirection="column" width="100%">
      <box
        ref={(element: Renderable) => {
          refsByKey.set("scan", element);
          syncRefs();
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={
          props.detailFocused() && props.detailCursorIndex() === 0 ? t().backgroundElementActive : undefined
        }
      >
        <text
          flexGrow={1}
          fg={props.detailFocused() && props.detailCursorIndex() === 0 ? t().accent : t().foreground}
          wrapMode="none"
        >
          {props.scan ? "Rescan commit" : "Scan commit"}
        </text>
        <Show when={props.loading}>
          <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
            scanning...
          </text>
        </Show>
      </box>

      <Show when={props.scan}>
        <box flexDirection="row" width="100%">
          <text flexGrow={1} fg={t().foregroundMuted} wrapMode="none">
            total vulnerabilities
          </text>
          <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
            {props.scan?.findings.length ?? 0}
          </text>
        </box>
        <box flexDirection="row" width="100%">
          <text flexGrow={1} fg={t().foregroundMuted} wrapMode="none">
            scanned
          </text>
          <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
            {props.scan ? formatRelativeDate(props.scan.scannedAt) : ""}
          </text>
        </box>
        <Show when={props.scan?.partial}>
          <text fg={t().warning} wrapMode="none" truncate>
            {`partial scan · ${props.scan?.failedProjects ?? 0} project${props.scan?.failedProjects === 1 ? "" : "s"} failed`}
          </text>
        </Show>

        <For each={groups()}>
          {(group, groupIndex) => {
            const severityItem = (): FlatItem => ({ kind: "severity", severity: group.severity });
            const severityIndex = () => flatItems().findIndex(item => itemKey(item) === itemKey(severityItem()));
            const isEmpty = () => group.findings.length === 0;
            const severityCursored = () =>
              !isEmpty() && props.detailFocused() && props.detailCursorIndex() === severityIndex();
            const severityExpanded = () => expandedSeverities().has(group.severity);
            const groupIsLast = () => groupIndex() === groups().length - 1;
            return (
              <box flexDirection="column" width="100%">
                <box
                  ref={(element: Renderable) => {
                    if (isEmpty()) return;
                    refsByKey.set(itemKey(severityItem()), element);
                    syncRefs();
                  }}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={severityCursored() ? t().backgroundElementActive : undefined}
                >
                  <text flexShrink={0} wrapMode="none" fg={t().border}>
                    {isEmpty() ? (groupIsLast() ? "└───" : "├───") : groupIsLast() ? "└──" : "├──"}
                  </text>
                  <text flexShrink={0} wrapMode="none" fg={severityCursored() ? t().accent : t().foregroundMuted}>
                    {isEmpty() ? " " : severityExpanded() ? "▾ " : "▸ "}
                  </text>
                  <text
                    flexGrow={1}
                    flexShrink={1}
                    wrapMode="none"
                    fg={isEmpty() ? t().foregroundMuted : severityColor(t(), group.severity)}
                  >
                    {isEmpty() ? group.severity.toUpperCase() : <strong>{group.severity.toUpperCase()}</strong>}
                  </text>
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {group.findings.length}
                  </text>
                </box>

                <Show when={severityExpanded()}>
                  <For each={group.findings}>
                    {(finding, findingIndex) => {
                      const findingItem = (): FlatItem => ({
                        kind: "finding",
                        severity: group.severity,
                        finding,
                        occurrence: props.scan?.findings.indexOf(finding) ?? -1,
                      });
                      const key = () => itemKey(findingItem());
                      const index = () => flatItems().findIndex(item => itemKey(item) === key());
                      const cursored = () => props.detailFocused() && props.detailCursorIndex() === index();
                      const expanded = () => expandedFindings().has(key());
                      const lead = () => (groupIsLast() ? "   " : "│  ");
                      const findingIsLast = () => findingIndex() === group.findings.length - 1;
                      const connector = () => (findingIsLast() ? "└─ " : "├─ ");
                      const label = () => {
                        const value = findingLabel(finding);
                        if (!cursored() || bannerOverflow() === 0) return value;
                        const offset = bannerOffset();
                        return value.substring(offset, offset + findingLabelWidth());
                      };
                      return (
                        <box flexDirection="column" width="100%">
                          <box
                            ref={(element: Renderable) => {
                              refsByKey.set(key(), element);
                              syncRefs();
                            }}
                            flexDirection="row"
                            width="100%"
                            backgroundColor={cursored() ? t().backgroundElementActive : undefined}
                          >
                            <text flexShrink={0} wrapMode="none" fg={t().border}>
                              {lead()}
                              {connector()}
                            </text>
                            <text flexShrink={0} wrapMode="none" fg={cursored() ? t().accent : t().foregroundMuted}>
                              {expanded() ? "▾ " : "▸ "}
                            </text>
                            <text
                              flexGrow={1}
                              flexShrink={1}
                              wrapMode="none"
                              truncate={bannerOverflow() === 0 || !cursored()}
                              fg={cursored() ? t().accent : t().foreground}
                            >
                              {label()}
                            </text>
                          </box>

                          <Show when={expanded()}>
                            <box flexDirection="column" width="100%">
                              {[
                                { text: finding.title, wrap: true, success: false },
                                (finding.cves?.length ?? 0) > 0
                                  ? { text: finding.cves?.join(", ") ?? "", wrap: true, success: false }
                                  : null,
                                finding.dependencyType === "direct"
                                  ? { text: "Direct dependency", wrap: false, success: false }
                                  : finding.dependencyType === "transitive"
                                    ? { text: "Transitive dependency", wrap: false, success: false }
                                    : null,
                                finding.upgradeDependency && finding.upgradeVersion
                                  ? {
                                      text: `${compactDependencyName(finding.upgradeDependency)} ${
                                        dependencyVersion(finding.dependencyPath, finding.upgradeDependency) ?? "?"
                                      } → ${finding.upgradeVersion}`,
                                      wrap: false,
                                      success: true,
                                    }
                                  : !finding.upgradeVersion && finding.fixedVersion
                                    ? { text: `Fixed in ${finding.fixedVersion}`, wrap: false, success: true }
                                    : null,
                              ]
                                .filter(
                                  (line): line is { text: string; wrap: boolean; success: boolean } => line !== null,
                                )
                                .map((field, fieldIndex, fields) => {
                                  const fieldIsLast = fieldIndex === fields.length - 1;
                                  const lines = field.wrap ? wrapWords(field.text, metadataWidth()) : [field.text];
                                  return lines.map((line, lineIndex) => (
                                    <box flexDirection="row" width="100%">
                                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                                        {lead()}
                                        {findingIsLast() ? "   " : "│  "}
                                        {lineIndex === 0 ? (fieldIsLast ? "└─ " : "├─ ") : fieldIsLast ? "   " : "│  "}
                                      </text>
                                      <text
                                        flexGrow={1}
                                        flexShrink={1}
                                        fg={field.success ? t().success : t().foregroundMuted}
                                        wrapMode="none"
                                        truncate
                                      >
                                        {line}
                                      </text>
                                    </box>
                                  ));
                                })}
                            </box>
                          </Show>
                        </box>
                      );
                    }}
                  </For>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
