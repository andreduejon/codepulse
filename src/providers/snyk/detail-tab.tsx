import type { Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, Show, untrack } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../../constants";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { useT } from "../../hooks/use-t";
import { filterSnykFindings, SnykFilterRow, useSnykFilter } from "./filter";
import { countUniqueFindings, groupSnykFixes, groupSnykVulnerabilities, type SnykVulnerabilityEntry } from "./parser";
import { SnykControlRow, type SnykDetailTabProps, snykScanIdentity, useSnykRows } from "./tab-shared";
import type { SnykSeverity } from "./types";
import { useSnykTabMemory } from "./view-memory";
import {
  detailLines,
  type FlatItem,
  itemKey,
  type PackageRow,
  packagesOf,
  ROW_TAIL_WIDTH,
  type Section,
  shortCoordinate,
} from "./vulnerabilities-model";
import { SectionView, type VulnerabilityRowsView } from "./vulnerabilities-rows";

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
  const rowsUi = useSnykRows(props, () => activateCurrentItem());

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
  const scanIdentity = createMemo(() => snykScanIdentity(props.scan));
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
        failedTargets: scan.failedTargets ?? [],
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
    on(scanIdentity, identity => {
      resettingFilter = filter.query() !== "";
      filter.reset();
      // Jump from Dependencies: show that package's findings.
      const pending = props.takePendingFilter?.();
      // Back from another tab on the same scan: restore the view as it was left (a jump replaces the filter).
      const restore = savedView(identity);
      const query = pending || restore?.query;
      if (query) {
        resettingFilter = false;
        filter.setQuery(query);
      }
      setGroupBy(restore?.groupBy ?? "severity");
      setExpandedSections(new Set(restore?.expandedSections ?? SEVERITIES.map(severity => `severity:${severity}`)));
      setExpandedFindings(new Set(restore?.expandedFindings));
      setCollapsedGroups(new Set(restore?.collapsedGroups));
      if (restore && !pending) {
        filter.suppressAutoEdit();
        props.setDetailCursorIndex(restore.cursor);
      } else props.setDetailCursorIndex(0);
      props.navRef?.scrollToCursor?.();
    }),
  );

  const savedView = useSnykTabMemory({
    memory: props.memory,
    key: "vulnerabilities",
    identity: scanIdentity,
    cursor: props.detailCursorIndex,
    active: props.active,
    view: () => ({
      groupBy: groupBy(),
      query: filter.query(),
      expandedSections: expandedSections(),
      expandedFindings: expandedFindings(),
      collapsedGroups: collapsedGroups(),
    }),
  });

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

  const view: VulnerabilityRowsView = {
    rows: rowsUi,
    indexOf,
    rowRef,
    mouseEnabled: () => props.mouseEnabled,
    query: filter.query,
    copiedId,
    bannerOverflow,
    scrolled,
    metadataWidth,
    findingLabelWidth,
    sectionLabelWidth,
    findingExpanded: key => expandedFindings().has(key),
    sectionExpanded: isSectionExpanded,
    packageExpanded: isPackageExpanded,
  };

  return (
    <box flexDirection="column" width="100%">
      <SnykControlRow
        rows={rowsUi}
        id="scan"
        index={0}
        label={props.scan ? "Rescan commit" : "Scan commit"}
        status={props.loading ? "scanning..." : undefined}
        mouseEnabled={props.mouseEnabled}
        rowRef={element => {
          refsByKey.set("scan", element);
          syncRefs();
        }}
      />

      <Show when={props.scan}>
        <Show when={originalTotal() > 0}>
          <SnykControlRow
            rows={rowsUi}
            id="copyJson"
            index={COPY_INDEX}
            label="Copy scan as JSON"
            copied={copiedId() === "copyJson"}
            mouseEnabled={props.mouseEnabled}
            rowRef={rowRef({ kind: "copyJson" })}
          />
          <box height={1} flexShrink={0} />
          <SnykControlRow
            rows={rowsUi}
            id="groupBy"
            index={GROUP_BY_INDEX}
            label="Group by"
            value={groupBy()}
            mouseEnabled={props.mouseEnabled}
            rowRef={rowRef({ kind: "groupBy" })}
          />
          <SnykFilterRow
            filter={filter}
            selected={rowsUi.cursored(FILTER_INDEX)}
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
            {`partial scan · ${props.scan?.failedProjects ?? 0} project${props.scan?.failedProjects === 1 ? "" : "s"} failed${props.scan?.failedTargets ? `: ${props.scan.failedTargets.join(", ")}` : ""}`}
          </text>
        </Show>

        <box height={1} flexShrink={0} />
        <For each={sections()}>{section => <SectionView view={view} section={section} />}</For>
      </Show>
    </box>
  );
}
