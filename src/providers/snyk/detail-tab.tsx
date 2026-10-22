import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../../constants";
import type { Theme } from "../../context/theme";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { useT } from "../../hooks/use-t";
import { filterSnykFindings, highlightMatch, SnykFilterRow, useSnykFilter } from "./filter";
import {
  countUniqueFindings,
  groupSnykFixes,
  groupSnykVulnerabilities,
  isMatureExploit,
  type SnykFixGroup,
  type SnykFixKind,
  type SnykFixPackage,
  type SnykVulnerabilityEntry,
} from "./parser";
import type { SnykScanResult, SnykSeverity } from "./types";

export interface SnykDetailTabProps {
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  scan: SnykScanResult | null;
  onScan: () => void | Promise<void>;
  contentWidth?: number;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  /** Vulnerabilities: a filter handed over by the Dependencies jump, read once when the tab opens. */
  takePendingFilter?: () => string | null;
}

const SEVERITIES: SnykSeverity[] = ["critical", "high", "medium", "low"];
const MIN_PANEL_WIDTH = 60;
const PANEL_PADDING_X = 4;
const FINDING_PREFIX_WIDTH = 5;
const METADATA_PREFIX_WIDTH = 6;
const COPY_INDEX = 1;
const GROUP_BY_INDEX = 2;
const FILTER_INDEX = 3;
type GroupBy = "severity" | "dependency";
const GROUP_BY_OPTIONS: GroupBy[] = ["severity", "dependency"];
type Section = {
  key: string;
  /** Header text: `HIGH` or the short `artifact@version`. */
  label: string;
  severity?: SnykSeverity;
  /** Dependency view only: package rows, listed from the unfiltered scan. */
  packages?: PackageRow[];
  entries: SnykVulnerabilityEntry[];
  /** Unfiltered entry count, shown as `/M` while filtering. */
  original: number;
};
type PackageRow = {
  key: string;
  name: string;
  /** The group's own dependency; shown as muted `self`. */
  self: boolean;
  entries: SnykVulnerabilityEntry[];
  original: number;
};
type DetailField = "title" | "package" | "via" | "manifest" | "paths" | "exploit" | "fix";
type DetailLine = {
  text: string;
  /** Shown instead of `text` while the cursor is on the row (e.g. full Maven coordinates). */
  full?: string;
  /** Right-aligned muted text (e.g. `11.0.24 → 11.0.25`). */
  suffix?: string;
  tone: "plain" | "muted" | "exploit" | SnykFixKind;
  wrap?: boolean;
  field?: DetailField;
  copy?: string;
};
type FlatItem =
  | { kind: "scan" }
  | { kind: "copyJson" }
  | { kind: "groupBy" }
  | { kind: "filter" }
  | { kind: "section"; section: Section }
  | { kind: "package"; pkg: PackageRow }
  | { kind: "finding"; entry: SnykVulnerabilityEntry }
  | { kind: "field"; owner: string; line: DetailLine };

export function severityColor(theme: Theme, severity: SnykSeverity): string {
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

/** Coloured markers (space-separated), then a muted label. */
export type SnykLegendItem = [markers: [string, (theme: Theme) => string][], label: string];
const LEGEND: SnykLegendItem[] = [
  [[["●", theme => toneColor(theme, "upgrade")]], "upgrade"],
  [[["●", theme => toneColor(theme, "override")]], "override"],
  [[["●", theme => toneColor(theme, "no fix")]], "no fix"],
  [[["!", theme => toneColor(theme, "exploit")]], "mature exploit"],
];
/** Row tail: " " + 4-char score + " " + exploit marker + " " + fix dot (colored like CI status). */
const ROW_TAIL_WIDTH = 9;

function toneColor(theme: Theme, tone: DetailLine["tone"]): string {
  if (tone === "upgrade") return theme.success;
  if (tone === "override") return theme.warning;
  if (tone === "plain") return theme.foreground;
  return tone === "exploit" ? theme.error : theme.foregroundMuted;
}

/** `group:artifact@version` → `artifact@version`; npm names have no group and stay as they are. */
function shortCoordinate(value: string): string {
  return value.slice(value.lastIndexOf(":") + 1);
}

/** Package rows of a group: the dependency itself (`self`) first, then overrides. */
function packagesOf(group: SnykFixGroup): SnykFixPackage[] {
  return [...(group.self ? [group.self] : []), ...group.packages];
}

function fixText(entry: SnykVulnerabilityEntry): string {
  const finding = entry.finding;
  if (finding.upgradeDependency && finding.upgradeVersion)
    return `Upgrade ${compactDependencyName(finding.upgradeDependency)} ${
      dependencyVersion(finding.dependencyPath, finding.upgradeDependency) ?? "?"
    } → ${finding.upgradeVersion}`;
  if (entry.fix === "upgrade")
    return `Upgrade ${compactDependencyName(finding.dependency)} ${finding.installedVersion} → ${finding.fixedVersion}`;
  return finding.fixedVersion ? `Fixed in ${finding.fixedVersion}` : "No fixed version available";
}

function detailLines(entry: SnykVulnerabilityEntry): DetailLine[] {
  const finding = entry.finding;
  const via = finding.dependencyType === "transitive" ? finding.dependencyPath?.[0] : undefined;
  const pkg = `${finding.dependency}@${finding.installedVersion}`;
  const exploit =
    finding.exploit && !/^(not defined|no known exploit)$/i.test(finding.exploit) ? finding.exploit : null;
  const lines: (DetailLine | null)[] = [
    { text: finding.title, tone: "muted", wrap: true, field: "title", copy: finding.title },
    { text: shortCoordinate(pkg), full: pkg, tone: "muted", field: "package", copy: pkg },
    via
      ? { text: `via ${shortCoordinate(via)}`, full: `via ${via}`, tone: "muted", field: "via", copy: via }
      : finding.dependencyType === "direct"
        ? { text: "direct dependency", tone: "muted", field: "via", copy: pkg }
        : null,
    finding.targetFile
      ? { text: finding.targetFile, tone: "muted", field: "manifest", copy: finding.targetFile }
      : null,
    entry.paths > 1
      ? { text: `${entry.paths} paths`, tone: "muted", field: "paths", copy: `${entry.paths} paths` }
      : null,
    exploit
      ? {
          text: `Exploit: ${exploit}`,
          tone: isMatureExploit(finding) ? "exploit" : "muted",
          field: "exploit",
          copy: exploit,
        }
      : null,
    { text: fixText(entry), tone: entry.fix, field: "fix", copy: fixText(entry) },
  ];
  return lines.filter((line): line is DetailLine => line !== null);
}

function itemKey(item: FlatItem): string {
  if (item.kind === "scan" || item.kind === "copyJson" || item.kind === "groupBy" || item.kind === "filter")
    return item.kind;
  if (item.kind === "section") return `section:${item.section.key}`;
  if (item.kind === "package") return item.pkg.key;
  if (item.kind === "finding") return `finding:${item.entry.key}`;
  return `field:${item.owner}:${item.line.field}:${item.line.copy ?? item.line.text}`;
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
  const [groupBy, setGroupBy] = createSignal<GroupBy>("severity");
  const [expandedSections, setExpandedSections] = createSignal<Set<string>>(
    new Set(SEVERITIES.map(severity => `severity:${severity}`)),
  );
  const [expandedFindings, setExpandedFindings] = createSignal<Set<string>>(new Set());
  /** Dependency groups and packages start open (CVEs closed); track the ones closed. */
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());
  const isSectionExpanded = (section: Section) =>
    section.severity ? expandedSections().has(section.key) : !collapsedGroups().has(section.key);
  const isPackageExpanded = (pkg: PackageRow) => !collapsedGroups().has(pkg.key);
  const filter = useSnykFilter(props, FILTER_INDEX);
  const { copiedId, copyToClipboard } = useClipboard();
  let resettingFilter = false;
  const refsByKey = new Map<string, Renderable>();
  const itemRefs: Renderable[] = [];
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const mouseRow = (key: string, index: () => number) => ({
    onMouseOver: () => setHoveredKey(key),
    onMouseOut: () => setHoveredKey(null),
    onMouseDown: (event: MouseEvent) => {
      if (!props.mouseEnabled || event.button !== MouseButton.LEFT || index() < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "scan" && props.loading) return;
      props.onMouseFocus?.();
      props.setDetailCursorIndex(index());
      activateCurrentItem();
    },
  });
  const hoverBg = (key: string) =>
    props.mouseEnabled && hoveredKey() === key && (key !== "scan" || !props.loading)
      ? t().backgroundElement
      : undefined;

  const filteredFindings = createMemo(() => filterSnykFindings(props.scan?.findings ?? [], filter.query()));
  const entries = createMemo(() => groupSnykVulnerabilities(filteredFindings()));
  const originalCounts = createMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<SnykSeverity, number>;
    for (const entry of groupSnykVulnerabilities(props.scan?.findings ?? [])) counts[entry.finding.severity]++;
    return counts;
  });
  const originalTotal = createMemo(() => SEVERITIES.reduce((sum, severity) => sum + originalCounts()[severity], 0));
  const uniqueTotal = createMemo(() => entries().length);
  // Unfiltered groups fix the list and its order, so filtering only changes counts (like severities).
  const originalGroups = createMemo(() => groupSnykFixes(groupSnykVulnerabilities(props.scan?.findings ?? [])));
  const sections = createMemo<Section[]>(() => {
    if (!props.scan) return [];
    if (groupBy() === "dependency") {
      const filtered = new Map(groupSnykFixes(entries()).map(group => [group.key, group]));
      return originalGroups().map(original => {
        const group = filtered.get(original.key);
        const key = `fix:${original.key}`;
        const current = new Map((group ? packagesOf(group) : []).map(pkg => [pkg.name, pkg.entries]));
        return {
          key,
          label: shortCoordinate(original.key),
          entries: group?.entries ?? [],
          original: original.entries.length,
          packages: packagesOf(original).map(pkg => ({
            key: `package:${key}:${pkg.name}`,
            name: pkg.name,
            self: pkg === original.self,
            entries: current.get(pkg.name) ?? [],
            original: pkg.entries.length,
          })),
        };
      });
    }
    return SEVERITIES.map(severity => ({
      key: `severity:${severity}`,
      label: severity.toUpperCase(),
      severity,
      entries: entries().filter(entry => entry.finding.severity === severity),
      original: originalCounts()[severity],
    }));
  });

  const entryItems = (entry: SnykVulnerabilityEntry): FlatItem[] => [
    { kind: "finding", entry },
    ...(expandedFindings().has(entry.key)
      ? detailLines(entry)
          .filter(line => line.field)
          .map((line): FlatItem => ({ kind: "field", owner: entry.key, line }))
      : []),
  ];
  const flatItems = createMemo<FlatItem[]>(() => [
    { kind: "scan" as const },
    // Copy, Group by and filter only when the scan has findings to show.
    ...(originalTotal() > 0
      ? [{ kind: "copyJson" as const }, { kind: "groupBy" as const }, { kind: "filter" as const }]
      : []),
    ...sections().flatMap((section): FlatItem[] =>
      section.entries.length === 0
        ? []
        : [
            { kind: "section", section },
            ...(isSectionExpanded(section)
              ? section.packages
                ? section.packages.flatMap((pkg): FlatItem[] =>
                    pkg.entries.length === 0
                      ? []
                      : [{ kind: "package", pkg }, ...(isPackageExpanded(pkg) ? pkg.entries.flatMap(entryItems) : [])],
                  )
                : section.entries.flatMap(entryItems)
              : []),
          ],
    ),
  ]);
  const itemIndexes = createMemo(() => new Map(flatItems().map((item, index) => [itemKey(item), index])));
  const indexOf = (item: FlatItem) => itemIndexes().get(itemKey(item)) ?? -1;
  const isCursor = (index: number) => index >= 0 && props.detailFocused() && props.detailCursorIndex() === index;

  const panelUsableWidth = () =>
    Math.max(
      1,
      props.contentWidth ??
        Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X,
    );
  /** Dependency view nests CVEs one level deeper (under package rows). */
  const nesting = () => (groupBy() === "dependency" ? 3 : 0);
  const findingLabelWidth = () => Math.max(1, panelUsableWidth() - FINDING_PREFIX_WIDTH - ROW_TAIL_WIDTH - nesting());
  const sectionLabelWidth = (section: Section) =>
    Math.max(1, panelUsableWidth() - 2 - String(section.entries.length).length - 1);
  const metadataWidth = () => Math.max(10, panelUsableWidth() - METADATA_PREFIX_WIDTH - nesting());
  const cursorItem = () => (props.detailFocused() ? flatItems()[props.detailCursorIndex()] : undefined);
  const bannerOverflow = createMemo(() => {
    const item = cursorItem();
    if (item?.kind === "finding") return Math.max(0, item.entry.label.length - findingLabelWidth());
    if (item?.kind === "section" && !item.section.severity)
      return Math.max(0, item.section.label.length - sectionLabelWidth(item.section));
    if (item?.kind === "field" && !item.line.wrap)
      return Math.max(0, (item.line.full ?? item.line.text).length - metadataWidth());
    return 0;
  });
  const scanIdentity = createMemo(() => (props.scan ? `${props.scan.sha}:${props.scan.scannedAt}` : ""));
  const bannerOffset = useBannerScroll(bannerOverflow);
  const scrolled = (text: string, active: boolean, width: number) => {
    if (!active || bannerOverflow() === 0) return text;
    return text.substring(bannerOffset(), bannerOffset() + width);
  };

  const syncRefs = () => {
    const items = flatItems();
    itemRefs.length = items.length;
    items.forEach((item, index) => {
      const ref = refsByKey.get(itemKey(item));
      if (ref) itemRefs[index] = ref;
    });
    if (props.navRef) props.navRef.itemRefs = itemRefs;
  };
  const rowRef = (item: FlatItem) => (element: Renderable) => {
    refsByKey.set(itemKey(item), element);
    const index = indexOf(item);
    if (index >= 0) itemRefs[index] = element;
  };

  /** Parsed scan as both views see it (findings limited by the filter); graphs stay out — they are large. */
  const scanJson = () => {
    const scan = props.scan;
    if (!scan) return "";
    return JSON.stringify(
      {
        commit: scan.sha,
        scannedAt: scan.scannedAt,
        includesDev: scan.includesDev,
        partial: scan.partial ?? false,
        failedProjects: scan.failedProjects ?? 0,
        filter: filter.query().trim() || null,
        counts: scan.counts,
        filteredCounts: countUniqueFindings(filteredFindings()),
        projects: scan.dependencyProjects.map(({ targetFile, packageManager, status, reason }) => ({
          targetFile,
          packageManager,
          status,
          reason,
        })),
        findings: filteredFindings(),
      },
      null,
      2,
    );
  };

  const toggle = (setter: typeof setExpandedSections, key: string) =>
    setter(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const update = (setter: typeof setExpandedSections, change: (next: Set<string>) => void) =>
    setter(previous => {
      const next = new Set(previous);
      change(next);
      return next;
    });
  /** Closing a node closes everything below it, so reopening starts from closed children. */
  const closeEntries = (closed: SnykVulnerabilityEntry[]) =>
    update(setExpandedFindings, next => {
      for (const entry of closed) next.delete(entry.key);
    });
  const toggleSection = (section: Section) => {
    const open = isSectionExpanded(section);
    if (open) closeEntries(section.entries);
    if (section.severity) toggle(setExpandedSections, section.key);
    else
      update(setCollapsedGroups, next => {
        if (!open) next.delete(section.key);
        else for (const key of [section.key, ...(section.packages ?? []).map(pkg => pkg.key)]) next.add(key);
      });
  };
  const togglePackage = (pkg: PackageRow) => {
    if (isPackageExpanded(pkg)) closeEntries(pkg.entries);
    toggle(setCollapsedGroups, pkg.key);
  };

  createEffect(
    on(scanIdentity, () => {
      resettingFilter = filter.query() !== "";
      filter.reset();
      // Jump from Dependencies: show that package's findings; the query effect puts the cursor on the filter.
      const pending = props.takePendingFilter?.();
      if (pending) {
        resettingFilter = false;
        filter.setQuery(pending);
      }
      setExpandedSections(new Set(SEVERITIES.map(severity => `severity:${severity}`)));
      setExpandedFindings(new Set<string>());
      setCollapsedGroups(new Set<string>());
      props.setDetailCursorIndex(0);
      props.navRef?.scrollToCursor?.();
    }),
  );

  createEffect(
    on(
      filter.query,
      () => {
        if (resettingFilter) {
          resettingFilter = false;
          return;
        }
        props.setDetailCursorIndex(FILTER_INDEX);
        props.navRef?.scrollToCursor?.();
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const count = flatItems().length;
    const cursor = untrack(() => props.detailCursorIndex());
    if (count === 0) props.setDetailCursorIndex(0);
    else if (cursor < 0 || cursor >= count) props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  const activateCurrentItem = () => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!item) return false;
    if (item.kind === "filter") {
      if (filter.editing()) filter.stop();
      else filter.start();
      return false;
    }
    filter.stop();
    if (item.kind === "scan") {
      if (!props.loading) void props.onScan();
    } else if (item.kind === "copyJson") copyToClipboard(scanJson(), "copyJson");
    else if (item.kind === "groupBy")
      setGroupBy(GROUP_BY_OPTIONS[(GROUP_BY_OPTIONS.indexOf(groupBy()) + 1) % GROUP_BY_OPTIONS.length]);
    else if (item.kind === "section") toggleSection(item.section);
    else if (item.kind === "package") togglePackage(item.pkg);
    else if (item.kind === "finding") toggle(setExpandedFindings, item.entry.key);
    else if (item.line.copy) copyToClipboard(item.line.copy, itemKey(item));
    return false;
  };

  createEffect(() => {
    const items = flatItems();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    syncRefs();
    props.navRef.activateCurrentItem = activateCurrentItem;
  });

  createEffect(() => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!props.detailFocused() || !item) {
      props.setDetailCursorAction(null);
      return;
    }
    if (item.kind === "filter") props.setDetailCursorAction(filter.editing() ? "done" : "filter");
    else if (item.kind === "scan") props.setDetailCursorAction(props.loading ? null : props.scan ? "rescan" : "scan");
    else if (item.kind === "groupBy") props.setDetailCursorAction("switch");
    else if (item.kind === "field" || item.kind === "copyJson") props.setDetailCursorAction("copy");
    else {
      const expanded =
        item.kind === "section"
          ? isSectionExpanded(item.section)
          : item.kind === "package"
            ? isPackageExpanded(item.pkg)
            : expandedFindings().has(item.entry.key);
      props.setDetailCursorAction(expanded ? "collapse" : "expand");
    }
  });

  const scoreText = (score: number | null) => (score == null ? "" : score.toFixed(1));

  const Field = (fieldProps: { owner: string; line: DetailLine; last: boolean; branch: string }) => {
    const line = fieldProps.line;
    const item: FlatItem = { kind: "field", owner: fieldProps.owner, line };
    const key = itemKey(item);
    const index = () => (line.field ? indexOf(item) : -1);
    const cursored = () => isCursor(index());
    const texts = () => (line.wrap ? wrapWords(line.text, metadataWidth()) : [line.text]);
    const rows = () =>
      texts().map((text, textIndex) => (
        <box flexDirection="row" width="100%">
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
            {fieldProps.branch}
            {textIndex === 0 ? (fieldProps.last ? "└─ " : "├─ ") : fieldProps.last ? "   " : "│  "}
          </text>
          <text
            selectable={!props.mouseEnabled}
            flexGrow={1}
            flexShrink={1}
            wrapMode="none"
            truncate={bannerOverflow() === 0 || !cursored()}
            fg={cursored() ? t().accent : toneColor(t(), line.tone)}
          >
            {line.wrap
              ? highlightMatch(text, filter.query(), t().snykBg)
              : cursored()
                ? scrolled(line.full ?? text, true, metadataWidth())
                : highlightMatch(text, filter.query(), t().snykBg)}
          </text>
          <Show when={textIndex === 0 && line.suffix}>
            <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {` ${line.suffix}`}
            </text>
          </Show>
          <Show when={textIndex === 0 && line.field && copiedId() === key}>
            <text selectable={!props.mouseEnabled} flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
              {" \u2713 copied "}
            </text>
          </Show>
        </box>
      ));
    if (!line.field) return <>{rows()}</>;
    return (
      <box
        {...mouseRow(key, index)}
        ref={rowRef(item)}
        flexDirection="column"
        width="100%"
        backgroundColor={cursored() ? t().backgroundElementActive : hoverBg(key)}
      >
        {rows()}
      </box>
    );
  };

  const Entry = (entryProps: { entry: SnykVulnerabilityEntry; last: boolean; indent?: string }) => {
    const indent = entryProps.indent ?? "";
    const entry = entryProps.entry;
    const item: FlatItem = { kind: "finding", entry };
    const key = itemKey(item);
    const index = () => indexOf(item);
    const cursored = () => isCursor(index());
    const expanded = () => expandedFindings().has(entry.key);
    const lines = () => detailLines(entry);
    return (
      <box flexDirection="column" width="100%">
        <box
          {...mouseRow(key, index)}
          ref={rowRef(item)}
          flexDirection="row"
          width="100%"
          backgroundColor={cursored() ? t().backgroundElementActive : hoverBg(key)}
        >
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
            {indent}
            {entryProps.last ? "└─ " : "├─ "}
          </text>
          <text
            selectable={!props.mouseEnabled}
            flexShrink={0}
            wrapMode="none"
            fg={cursored() ? t().accent : t().foregroundMuted}
          >
            {expanded() ? "▾ " : "▸ "}
          </text>
          <text
            selectable={!props.mouseEnabled}
            flexGrow={1}
            flexShrink={1}
            wrapMode="none"
            truncate={bannerOverflow() === 0 || !cursored()}
            fg={cursored() ? t().accent : t().foreground}
          >
            {cursored()
              ? scrolled(entry.label, true, findingLabelWidth())
              : highlightMatch(entry.label, filter.query(), t().snykBg)}
          </text>
          {/* "!" sits right before the score: padding + marker + space, then the score (7 columns total). */}
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().error}>
            {`${" ".repeat(5 - scoreText(entry.finding.cvssScore).length)}${isMatureExploit(entry.finding) ? "!" : " "} `}
          </text>
          {/* Score carries the severity color in both views; labels stay plain. */}
          <text
            selectable={!props.mouseEnabled}
            flexShrink={0}
            wrapMode="none"
            fg={severityColor(t(), entry.finding.severity)}
          >
            {scoreText(entry.finding.cvssScore)}
          </text>
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={toneColor(t(), entry.fix)}>
            {" ●"}
          </text>
        </box>
        <Show when={expanded()}>
          <box flexDirection="column" width="100%">
            <For each={lines()}>
              {(line, lineIndex) => (
                <Field
                  owner={entry.key}
                  line={line}
                  last={lineIndex() === lines().length - 1}
                  branch={indent + (entryProps.last ? "   " : "│  ")}
                />
              )}
            </For>
          </box>
        </Show>
      </box>
    );
  };

  /** Right-aligned muted count, `current/original` while filtering. */
  const Count = (countProps: { current: number; original: number; selectable: boolean }) => (
    <text selectable={countProps.selectable} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
      {` ${countProps.current}${filter.query().trim() && countProps.original > 0 ? `/${countProps.original}` : ""}`}
    </text>
  );

  const PackageView = (packageProps: { pkg: PackageRow; last: boolean }) => {
    const pkg = packageProps.pkg;
    const item: FlatItem = { kind: "package", pkg };
    const key = itemKey(item);
    const index = () => indexOf(item);
    const isEmpty = () => pkg.entries.length === 0;
    const cursored = () => !isEmpty() && isCursor(index());
    const expanded = () => !isEmpty() && isPackageExpanded(pkg);
    return (
      <box flexDirection="column" width="100%">
        <box
          {...mouseRow(key, index)}
          ref={element => {
            if (!isEmpty()) rowRef(item)(element);
          }}
          flexDirection="row"
          width="100%"
          backgroundColor={cursored() ? t().backgroundElementActive : !isEmpty() ? hoverBg(key) : undefined}
        >
          <text selectable={!props.mouseEnabled || isEmpty()} flexShrink={0} wrapMode="none" fg={t().border}>
            {packageProps.last ? "└─ " : "├─ "}
          </text>
          <text
            selectable={!props.mouseEnabled || isEmpty()}
            flexShrink={0}
            wrapMode="none"
            fg={cursored() ? t().accent : t().foregroundMuted}
          >
            {isEmpty() ? "· " : expanded() ? "▾ " : "▸ "}
          </text>
          <text
            selectable={!props.mouseEnabled || isEmpty()}
            flexGrow={1}
            flexShrink={1}
            wrapMode="none"
            truncate
            fg={cursored() ? t().accent : pkg.self || isEmpty() ? t().foregroundMuted : t().foreground}
          >
            {pkg.self || cursored()
              ? pkg.self
                ? "self"
                : shortCoordinate(pkg.name)
              : highlightMatch(shortCoordinate(pkg.name), filter.query(), t().snykBg)}
          </text>
          <Count current={pkg.entries.length} original={pkg.original} selectable={!props.mouseEnabled || isEmpty()} />
        </box>
        <Show when={expanded()}>
          <For each={pkg.entries}>
            {(entry, entryIndex) => (
              <Entry
                entry={entry}
                last={entryIndex() === pkg.entries.length - 1}
                indent={packageProps.last ? "   " : "│  "}
              />
            )}
          </For>
        </Show>
      </box>
    );
  };

  const SectionView = (sectionProps: { section: Section }) => {
    const section = sectionProps.section;
    const item: FlatItem = { kind: "section", section };
    const key = itemKey(item);
    const index = () => indexOf(item);
    const isEmpty = () => section.entries.length === 0;
    const cursored = () => !isEmpty() && isCursor(index());
    const expanded = () => isSectionExpanded(section);
    const severity = section.severity;
    // Always the short name: swapping to full coordinates on the cursor made the header jump.
    const label = () => (severity ? section.label : scrolled(section.label, cursored(), sectionLabelWidth(section)));
    return (
      <box flexDirection="column" width="100%">
        <box
          {...mouseRow(key, index)}
          ref={element => {
            if (!isEmpty()) rowRef(item)(element);
          }}
          flexDirection="row"
          width="100%"
          backgroundColor={cursored() ? t().backgroundElementActive : !isEmpty() ? hoverBg(key) : undefined}
        >
          <text
            selectable={!props.mouseEnabled || isEmpty()}
            flexShrink={0}
            wrapMode="none"
            fg={cursored() ? t().accent : t().foregroundMuted}
          >
            {isEmpty() ? "· " : expanded() ? "▾ " : "▸ "}
          </text>
          <text
            selectable={!props.mouseEnabled || isEmpty()}
            flexGrow={1}
            flexShrink={1}
            wrapMode="none"
            truncate={bannerOverflow() === 0 || !cursored()}
            fg={
              isEmpty()
                ? t().foregroundMuted
                : severity
                  ? severityColor(t(), severity)
                  : cursored()
                    ? t().accent
                    : t().foreground
            }
          >
            {!isEmpty() ? <strong>{label()}</strong> : label()}
          </text>
          <Count
            current={section.entries.length}
            original={section.original}
            selectable={!props.mouseEnabled || isEmpty()}
          />
        </box>
        <Show when={expanded()}>
          <Show
            when={section.packages}
            fallback={
              <For each={section.entries}>
                {(entry, entryIndex) => <Entry entry={entry} last={entryIndex() === section.entries.length - 1} />}
              </For>
            }
          >
            {packages => (
              <For each={packages()}>
                {(pkg, pkgIndex) => <PackageView pkg={pkg} last={pkgIndex() === packages().length - 1} />}
              </For>
            )}
          </Show>
        </Show>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%">
      <box
        {...mouseRow("scan", () => 0)}
        ref={(element: Renderable) => {
          refsByKey.set("scan", element);
          syncRefs();
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={isCursor(0) ? t().backgroundElementActive : hoverBg("scan")}
      >
        <text
          selectable={!props.mouseEnabled}
          flexGrow={1}
          fg={isCursor(0) ? t().accent : t().foreground}
          wrapMode="none"
        >
          {props.scan ? "Rescan commit" : "Scan commit"}
        </text>
        <Show when={props.loading}>
          <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
            scanning...
          </text>
        </Show>
      </box>

      <Show when={props.scan}>
        <Show when={originalTotal() > 0}>
          <box
            {...mouseRow("copyJson", () => COPY_INDEX)}
            ref={rowRef({ kind: "copyJson" })}
            flexDirection="row"
            width="100%"
            backgroundColor={isCursor(COPY_INDEX) ? t().backgroundElementActive : hoverBg("copyJson")}
          >
            <text
              selectable={!props.mouseEnabled}
              flexGrow={1}
              wrapMode="none"
              fg={isCursor(COPY_INDEX) ? t().accent : t().foreground}
            >
              Copy scan as JSON
            </text>
            <Show when={copiedId() === "copyJson"}>
              <text
                selectable={!props.mouseEnabled}
                flexShrink={0}
                bg={t().primary}
                fg={t().background}
                wrapMode="none"
              >
                {" \u2713 copied "}
              </text>
            </Show>
          </box>
          <box height={1} flexShrink={0} />
          <box
            {...mouseRow("groupBy", () => GROUP_BY_INDEX)}
            ref={rowRef({ kind: "groupBy" })}
            flexDirection="row"
            width="100%"
            backgroundColor={isCursor(GROUP_BY_INDEX) ? t().backgroundElementActive : hoverBg("groupBy")}
          >
            <text
              selectable={!props.mouseEnabled}
              flexGrow={1}
              wrapMode="none"
              fg={isCursor(GROUP_BY_INDEX) ? t().accent : t().foreground}
            >
              Group by
            </text>
            <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foreground}>
              {`[${groupBy()}]`}
            </text>
          </box>
          <SnykFilterRow
            filter={filter}
            selected={isCursor(FILTER_INDEX)}
            mouseEnabled={props.mouseEnabled}
            rowRef={rowRef({ kind: "filter" })}
          >
            <text flexShrink={0} selectable={false} fg={t().foregroundMuted} wrapMode="none">
              {filter.query().trim() ? `${uniqueTotal()}/${originalTotal()}` : uniqueTotal()}
            </text>
          </SnykFilterRow>
        </Show>
        <Show when={props.scan?.partial}>
          <text fg={t().warning} wrapMode="none" truncate>
            {`partial scan · ${props.scan?.failedProjects ?? 0} project${props.scan?.failedProjects === 1 ? "" : "s"} failed`}
          </text>
        </Show>

        <box height={1} flexShrink={0} />
        <For each={sections()}>{section => <SectionView section={section} />}</For>
      </Show>
    </box>
  );
}

/** Fix/exploit legend; DetailPanel renders it sticky below the scroll area. */
export function SnykLegend(props: { items?: readonly SnykLegendItem[] }) {
  const t = useT();
  return (
    <box flexDirection="row" width="100%" flexShrink={0} justifyContent="flex-end">
      <For each={props.items ?? LEGEND}>
        {([markers, label], index) => (
          <>
            <Show when={index() > 0}>
              <text selectable={false} flexShrink={0} wrapMode="none">
                {"  "}
              </text>
            </Show>
            <For each={markers}>
              {([marker, color]) => (
                <text selectable={false} flexShrink={0} wrapMode="none" fg={color(t())}>
                  {`${marker} `}
                </text>
              )}
            </For>
            <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {label}
            </text>
          </>
        )}
      </For>
    </box>
  );
}
