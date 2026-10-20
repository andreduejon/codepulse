import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../../constants";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { useT } from "../../hooks/use-t";
import {
  buildDependencyTree,
  type DependencyGroupBy,
  type DependencyScopeFilter,
  type DependencyTreeRow,
  defaultDependencyExpansion,
  dependencyPackageList,
} from "./deps-tree";
import type { SnykDetailTabProps } from "./detail-tab";
import { SnykFilterRow, useSnykFilter } from "./filter";

export type SnykDependenciesTabProps = SnykDetailTabProps;

const GROUP_BY_OPTIONS: DependencyGroupBy[] = ["tree", "package"];
const SCOPE_OPTIONS: DependencyScopeFilter[] = ["all", "prod", "dev"];
const COPY_INDEX = 1;
const GROUP_BY_INDEX = 2;
const SCOPE_INDEX = 3;
const FILTER_INDEX = 4;
/** Cursor index of the first tree row (after scan, copy, group by, scope, filter). */
const ROW_BASE = 5;

export function SnykDependenciesTab(props: Readonly<SnykDependenciesTabProps>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const filter = useSnykFilter(props, FILTER_INDEX);
  const [scope, setScope] = createSignal<DependencyScopeFilter>("all");
  const [groupBy, setGroupBy] = createSignal<DependencyGroupBy>("tree");
  const projects = createMemo(() => props.scan?.dependencyProjects ?? []);
  const scanIdentity = createMemo(() => (props.scan ? `${props.scan.sha}:${props.scan.scannedAt}` : ""));
  const [expanded, setExpanded] = createSignal(defaultDependencyExpansion(projects()));
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const tree = createMemo(() => buildDependencyTree(projects(), expanded(), filter.query(), scope(), groupBy()));
  // <For> keys by identity; reuse unchanged rows so typing does not re-render thousands of them.
  let rowCache = new Map<string, { json: string; row: DependencyTreeRow }>();
  const rows = createMemo(() => {
    const next = new Map<string, { json: string; row: DependencyTreeRow }>();
    const list = tree().rows.map(row => {
      const json = JSON.stringify(row);
      const previous = rowCache.get(row.key);
      const kept = previous?.json === json ? previous : { json, row };
      next.set(row.key, kept);
      return kept.row;
    });
    rowCache = next;
    return list;
  });
  const filtering = () => !!filter.query().trim();
  /** Headers without anything to open (no matches, failed/skipped) are not cursor stops, like empty severities. */
  const isEmptyHeader = (row: DependencyTreeRow) => row.kind !== "dependency" && !row.expandable;
  const navRows = createMemo(() => rows().filter(row => !isEmptyHeader(row)));
  const navIndexes = createMemo(() => new Map(navRows().map((row, index) => [row.key, index + ROW_BASE])));
  const packageTotals = createMemo(() =>
    rows()
      .filter(row => row.kind === "project")
      .reduce((sum, row) => ({ count: sum.count + (row.count ?? 0), total: sum.total + (row.total ?? 0) }), {
        count: 0,
        total: 0,
      }),
  );
  const { copiedId, copyToClipboard } = useClipboard();
  const incompleteProjects = createMemo(() => projects().filter(project => project.status !== "scanned"));
  const refsByKey = new Map<string, Renderable>();
  const itemRefs: Renderable[] = [];
  let disposed = false;
  let previousView = "";

  const usableWidth = () =>
    Math.max(1, props.contentWidth ?? Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), 60) - 4);
  /** Right-aligned muted markers; nesting and these words replace arrow markers that read like errors. */
  const markers = (row: DependencyTreeRow) =>
    [row.direct ? "direct" : "", row.reference ? "repeated" : "", row.cycle ? "circular" : ""]
      .filter(Boolean)
      .map(word => ` ${word}`)
      .join("");
  const matchesText = (row: DependencyTreeRow) => (row.matches === undefined ? "" : ` ${row.matches}`);
  const suffixWidth = (row: DependencyTreeRow) =>
    markers(row).length + (row.scope === "dev" ? 4 : 0) + matchesText(row).length;
  const prefix = (row: DependencyTreeRow) => {
    const budget = Math.max(0, usableWidth() - 1 - suffixWidth(row));
    const connector = row.prefix.slice(Math.max(0, row.prefix.length - Math.max(0, budget - 11)));
    return connector.slice(0, Math.max(0, budget - 2));
  };
  const label = (row: DependencyTreeRow, full = false) => {
    const project = projects()[row.projectIndex];
    const incomplete = row.kind !== "dependency" && project?.status === "failed" && project.graphs.length > 0;
    // Maven `group:artifact@version` shows as `artifact@version`; the cursor row shows full coordinates.
    const name = row.kind === "dependency" && !full ? row.label.slice(row.label.lastIndexOf(":") + 1) : row.label;
    return `${name}${incomplete ? " · incomplete" : ""}`;
  };
  /** Nesting shows the path; the cursor row shows the full name, banner-scrolled when clipped. */
  const labelWidth = (row: DependencyTreeRow) => Math.max(1, usableWidth() - prefix(row).length - 2 - suffixWidth(row));
  const bannerOverflow = createMemo(() => {
    if (!props.detailFocused()) return 0;
    const row = navRows()[props.detailCursorIndex() - ROW_BASE];
    return row?.kind === "dependency" ? Math.max(0, label(row, true).length - labelWidth(row)) : 0;
  });
  const bannerOffset = useBannerScroll(bannerOverflow);
  /** Flat packages per project as the view sees them (scope and filter applied); graphs stay out — they are large. */
  const dependenciesJson = () => {
    const scan = props.scan;
    if (!scan) return "";
    return JSON.stringify(
      {
        commit: scan.sha,
        scannedAt: scan.scannedAt,
        includesDev: scan.includesDev,
        scope: scope(),
        filter: filter.query().trim() || null,
        projects: dependencyPackageList(projects(), filter.query(), scope()),
      },
      null,
      2,
    );
  };
  const syncRefs = () => {
    itemRefs.length = 0;
    for (const key of [
      "scan",
      ...(props.scan ? ["copyJson", "groupBy", "scope", "filter"] : []),
      ...navRows().map(row => row.key),
    ]) {
      itemRefs.push(refsByKey.get(key) as Renderable);
    }
    if (props.navRef) props.navRef.itemRefs = itemRefs;
  };
  const activateCurrentItem = () => {
    if (disposed) return false;
    const index = props.detailCursorIndex();
    if (props.scan && index === FILTER_INDEX) {
      if (filter.editing()) filter.stop();
      else filter.start();
      return false;
    }
    filter.stop();
    if (props.scan && index === SCOPE_INDEX) {
      setScope(SCOPE_OPTIONS[(SCOPE_OPTIONS.indexOf(scope()) + 1) % SCOPE_OPTIONS.length]);
      return false;
    }
    if (props.scan && index === COPY_INDEX) {
      copyToClipboard(dependenciesJson(), "copyJson");
      return false;
    }
    if (props.scan && index === GROUP_BY_INDEX) {
      setGroupBy(GROUP_BY_OPTIONS[(GROUP_BY_OPTIONS.indexOf(groupBy()) + 1) % GROUP_BY_OPTIONS.length]);
      return false;
    }
    if (index === 0) {
      if (!props.loading) void props.onScan();
      return false;
    }
    const row = navRows()[index - ROW_BASE];
    if (!row) return false;
    if (!row.expandable) {
      // Leaves copy the full `name@version`, like copy rows in Vulnerabilities.
      if (row.kind === "dependency") copyToClipboard(row.path[row.path.length - 1] ?? row.label, row.key);
      return false;
    }
    setExpanded(previous => {
      const next = new Set(previous);
      if (!next.has(row.key)) {
        next.add(row.key);
        if (!buildDependencyTree(projects(), next, filter.query(), scope(), groupBy()).truncated) return next;
        // Over the row cap: close other branches, keeping projects/modules and the path to this row.
        const kept = new Set([...previous].filter(key => !key.includes("/")));
        for (let at = row.key.indexOf("/"); at >= 0; at = row.key.indexOf("/", at + 1)) kept.add(row.key.slice(0, at));
        kept.add(row.key);
        return kept;
      }
      // Closing closes everything below, so reopening shows children closed.
      const graphPrefix = row.kind === "project" ? `["graph",${row.projectIndex},` : null;
      for (const key of previous)
        if (key === row.key || key.startsWith(`${row.key}/`) || (graphPrefix && key.startsWith(graphPrefix)))
          next.delete(key);
      return next;
    });
    return false;
  };
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
  const cursored = (index: number) => props.detailFocused() && props.detailCursorIndex() === index;
  const background = (key: string, index: number) =>
    cursored(index)
      ? t().backgroundElementActive
      : props.mouseEnabled && hoveredKey() === key && (key !== "scan" || !props.loading)
        ? t().backgroundElement
        : undefined;

  createEffect(() => {
    scanIdentity();
    untrack(() => {
      filter.reset();
      previousView = JSON.stringify(["", scope(), groupBy()]);
      setExpanded(defaultDependencyExpansion(projects(), "", scope(), groupBy()));
      setHoveredKey(null);
      props.setDetailCursorIndex(0);
      props.navRef?.scrollToCursor?.();
    });
  });

  createEffect(() => {
    const query = filter.query();
    const view = JSON.stringify([query, scope(), groupBy()]);
    if (view === previousView) return;
    const queryChanged = JSON.parse(previousView || "[]")[0] !== query;
    previousView = view;
    untrack(() => {
      setExpanded(defaultDependencyExpansion(projects(), query, scope(), groupBy()));
      // Switching Scope or Group by keeps the cursor on its row.
      if (!queryChanged) return;
      props.setDetailCursorIndex(FILTER_INDEX);
      props.navRef?.scrollToCursor?.();
    });
  });

  createEffect(() => {
    const count = navRows().length + (props.scan ? ROW_BASE : 1);
    const cursor = untrack(props.detailCursorIndex);
    if (cursor < 0 || cursor >= count) props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  createEffect(() => {
    const count = navRows().length + (props.scan ? ROW_BASE : 1);
    syncRefs();
    if (!props.navRef) return;
    props.navRef.itemCount = count;
    props.navRef.activateCurrentItem = activateCurrentItem;
  });

  createEffect(() => {
    const index = props.detailCursorIndex();
    const row = navRows()[index - ROW_BASE];
    if (!props.detailFocused()) {
      props.setDetailCursorAction(null);
      return;
    }
    if (index === 0) {
      props.setDetailCursorAction(props.loading ? null : props.scan ? "rescan" : "scan");
      return;
    }
    if (props.scan && index === COPY_INDEX) {
      props.setDetailCursorAction("copy");
      return;
    }
    if (props.scan && (index === SCOPE_INDEX || index === GROUP_BY_INDEX)) {
      props.setDetailCursorAction("switch");
      return;
    }
    if (props.scan && index === FILTER_INDEX) {
      props.setDetailCursorAction(filter.editing() ? "done" : "filter");
      return;
    }
    props.setDetailCursorAction(
      row?.expandable ? (row.expanded ? "collapse" : "expand") : row?.kind === "dependency" ? "copy" : null,
    );
  });

  onCleanup(() => {
    disposed = true;
    if (!props.navRef || props.navRef.activateCurrentItem === activateCurrentItem) {
      if (props.navRef) {
        props.navRef.itemCount = 0;
        props.navRef.itemRefs = [];
        props.navRef.activateCurrentItem = () => false;
      }
      props.setDetailCursorAction(null);
    }
    refsByKey.clear();
    itemRefs.length = 0;
  });

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <box
        {...mouseRow("scan", () => 0)}
        ref={(element: Renderable) => {
          refsByKey.set("scan", element);
          itemRefs[0] = element;
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={background("scan", 0)}
      >
        <text
          selectable={!props.mouseEnabled}
          flexGrow={1}
          flexShrink={1}
          fg={cursored(0) ? t().accent : t().foreground}
          wrapMode="none"
          truncate
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
        <box
          {...mouseRow("copyJson", () => COPY_INDEX)}
          ref={(element: Renderable) => {
            refsByKey.set("copyJson", element);
            itemRefs[COPY_INDEX] = element;
          }}
          flexDirection="row"
          width="100%"
          backgroundColor={background("copyJson", COPY_INDEX)}
        >
          <text
            selectable={!props.mouseEnabled}
            flexGrow={1}
            wrapMode="none"
            fg={cursored(COPY_INDEX) ? t().accent : t().foreground}
          >
            Copy dependencies as JSON
          </text>
          <Show when={copiedId() === "copyJson"}>
            <text selectable={!props.mouseEnabled} flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
              {" \u2713 copied "}
            </text>
          </Show>
        </box>
        <box height={1} flexShrink={0} />
        {/* Group by and Scope cycle like Group by in Vulnerabilities. */}
        <box
          {...mouseRow("groupBy", () => GROUP_BY_INDEX)}
          ref={(element: Renderable) => {
            refsByKey.set("groupBy", element);
            itemRefs[GROUP_BY_INDEX] = element;
          }}
          flexDirection="row"
          width="100%"
          backgroundColor={background("groupBy", GROUP_BY_INDEX)}
        >
          <text
            selectable={!props.mouseEnabled}
            flexGrow={1}
            wrapMode="none"
            fg={cursored(GROUP_BY_INDEX) ? t().accent : t().foreground}
          >
            Group by
          </text>
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foreground}>
            {`[${groupBy()}]`}
          </text>
        </box>
        <box
          {...mouseRow("scope", () => SCOPE_INDEX)}
          ref={(element: Renderable) => {
            refsByKey.set("scope", element);
            itemRefs[SCOPE_INDEX] = element;
          }}
          flexDirection="row"
          width="100%"
          backgroundColor={background("scope", SCOPE_INDEX)}
        >
          <text
            selectable={!props.mouseEnabled}
            flexGrow={1}
            wrapMode="none"
            fg={cursored(SCOPE_INDEX) ? t().accent : t().foreground}
          >
            Scope
          </text>
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foreground}>
            {`[${scope()}]`}
          </text>
        </box>
        <SnykFilterRow
          filter={filter}
          selected={cursored(FILTER_INDEX)}
          mouseEnabled={props.mouseEnabled}
          rowRef={(element: Renderable) => {
            refsByKey.set("filter", element);
            itemRefs[FILTER_INDEX] = element;
          }}
          placeholder="Enter dependency filter..."
        >
          <text
            flexShrink={0}
            selectable={false}
            fg={filtering() && packageTotals().count > 0 ? t().foreground : t().foregroundMuted}
            wrapMode="none"
          >
            {filtering() ? packageTotals().count : packageTotals().total}
          </text>
          <Show when={filtering()}>
            <text flexShrink={0} selectable={false} fg={t().foregroundMuted} wrapMode="none">
              {`/${packageTotals().total}`}
            </text>
          </Show>
        </SnykFilterRow>
        {/* Blank row before the tree, as in Vulnerabilities. */}
        <box height={1} flexShrink={0} />
      </Show>

      <Show
        when={props.scan}
        fallback={
          <text fg={t().foregroundMuted} wrapMode="word">
            No dependency scan for this commit. Scan commit to browse dependencies.
          </text>
        }
      >
        <Show when={projects().length === 0}>
          <text fg={t().foregroundMuted} wrapMode="word">
            No supported dependency projects found.
          </text>
        </Show>
        <For each={rows()}>
          {row => {
            let element: Renderable | undefined;
            const index = () => navIndexes().get(row.key) ?? -1;
            const header = row.kind !== "dependency";
            const empty = isEmptyHeader(row);
            onCleanup(() => {
              if (refsByKey.get(row.key) === element) refsByKey.delete(row.key);
            });
            return (
              <box flexDirection="column" width="100%" flexShrink={0}>
                <box
                  {...(empty ? {} : mouseRow(row.key, index))}
                  ref={(ref: Renderable) => {
                    if (empty) return;
                    element = ref;
                    refsByKey.set(row.key, ref);
                    if (index() >= 0) itemRefs[index()] = ref;
                  }}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={empty ? undefined : background(row.key, index())}
                >
                  {/* Empty text still takes a column; headers have no connector. */}
                  <Show when={prefix(row)}>
                    <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().border} wrapMode="none">
                      {prefix(row)}
                    </text>
                  </Show>
                  <text
                    selectable={!props.mouseEnabled}
                    flexShrink={0}
                    fg={cursored(index()) ? t().accent : t().foregroundMuted}
                    wrapMode="none"
                  >
                    {row.expandable ? (row.expanded ? "▾ " : "▸ ") : header ? "· " : "  "}
                  </text>
                  <text
                    selectable={!props.mouseEnabled}
                    flexGrow={1}
                    flexShrink={1}
                    fg={cursored(index()) ? t().accent : empty ? t().foregroundMuted : t().foreground}
                    wrapMode="none"
                    truncate
                  >
                    {header && !empty ? (
                      <strong>{label(row)}</strong>
                    ) : cursored(index()) && row.kind === "dependency" ? (
                      label(row, true).substring(bannerOffset(), bannerOffset() + labelWidth(row))
                    ) : (
                      label(row)
                    )}
                  </text>
                  {/* Project name: muted, right-aligned one gap before the count; it gives way first when space is tight. */}
                  <Show when={row.rootName}>
                    <text
                      selectable={!props.mouseEnabled}
                      flexShrink={100}
                      fg={t().foregroundMuted}
                      wrapMode="none"
                      truncate
                    >
                      {` ${row.rootName?.slice(row.rootName.lastIndexOf(":") + 1)}`}
                    </text>
                  </Show>
                  <Show when={markers(row)}>
                    <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
                      {markers(row)}
                    </text>
                  </Show>
                  <Show when={row.scope === "dev"}>
                    <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
                      {" dev"}
                    </text>
                  </Show>
                  {/* Closed rows while filtering: matches below, like header counts. */}
                  <Show when={matchesText(row)}>
                    <text
                      selectable={!props.mouseEnabled}
                      flexShrink={0}
                      fg={row.matches !== "0" ? t().foreground : t().foregroundMuted}
                      wrapMode="none"
                    >
                      {matchesText(row)}
                    </text>
                  </Show>
                  <Show when={copiedId() === row.key}>
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
                  {/* Headers count packages like severity headers count findings: N, or N/M while filtering. */}
                  <Show when={header && row.total !== undefined}>
                    <text
                      selectable={!props.mouseEnabled}
                      flexShrink={0}
                      fg={filtering() && (row.count ?? 0) > 0 ? t().foreground : t().foregroundMuted}
                      wrapMode="none"
                    >
                      {` ${row.count ?? 0}`}
                    </text>
                    <Show when={filtering() && (row.total ?? 0) > 0}>
                      <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
                        {`/${row.total}`}
                      </text>
                    </Show>
                  </Show>
                </box>
              </box>
            );
          }}
        </For>
        <Show when={tree().truncated}>
          <text fg={t().foregroundMuted} wrapMode="word">
            Dependency tree truncated at 1,000 dependencies. Filter to narrow results.
          </text>
        </Show>
        <Show when={tree().filterIncomplete}>
          <text fg={t().warning} wrapMode="word">
            {`${tree().matchCount} packages match; matching-path search is incomplete. Narrow the filter.`}
          </text>
        </Show>
        <For each={incompleteProjects()}>
          {project => (
            <text fg={project.status === "failed" ? t().warning : t().foregroundMuted} wrapMode="word">
              {`${project.targetFile}: ${project.status}${project.reason ? ` · ${project.reason}` : ""}`}
            </text>
          )}
        </For>
      </Show>
    </box>
  );
}
