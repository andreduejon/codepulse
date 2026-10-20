import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION } from "../../constants";
import { useT } from "../../hooks/use-t";
import { buildDependencyTree, type DependencyTreeRow, defaultDependencyExpansion } from "./deps-tree";
import type { SnykDetailTabProps } from "./detail-tab";
import { SnykFilterRow, useSnykFilter } from "./filter";

export type SnykDependenciesTabProps = SnykDetailTabProps;

export function SnykDependenciesTab(props: Readonly<SnykDependenciesTabProps>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const filter = useSnykFilter(props);
  const projects = createMemo(() => props.scan?.dependencyProjects ?? []);
  const scanIdentity = createMemo(() => (props.scan ? `${props.scan.sha}:${props.scan.scannedAt}` : ""));
  const [expanded, setExpanded] = createSignal(defaultDependencyExpansion(projects()));
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const tree = createMemo(() => buildDependencyTree(projects(), expanded(), filter.query()));
  const rows = createMemo(() => tree().rows);
  const incompleteProjects = createMemo(() => projects().filter(project => project.status !== "scanned"));
  const refsByKey = new Map<string, Renderable>();
  const itemRefs: Renderable[] = [];
  let disposed = false;
  let previousQuery = untrack(filter.query);

  const usableWidth = () =>
    Math.max(1, props.contentWidth ?? Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), 60) - 4);
  const prefix = (row: DependencyTreeRow) => {
    const budget = Math.max(0, usableWidth() - 1 - (row.scope === "dev" ? 4 : 0));
    const connector = row.prefix.slice(Math.max(0, row.prefix.length - Math.max(0, budget - 11)));
    return connector.slice(0, Math.max(0, budget - 2));
  };
  const label = (row: DependencyTreeRow) => {
    const project = projects()[row.projectIndex];
    const incomplete = row.kind !== "dependency" && project?.status === "failed" && project.graphs.length > 0;
    return (
      `${row.label}${row.reference ? " ↪ reference" : ""}` +
      `${row.cycle ? " ↩ cycle" : ""}${incomplete ? " · incomplete" : ""}`
    );
  };
  const syncRefs = () => {
    itemRefs.length = 0;
    for (const key of ["scan", ...(props.scan ? ["filter"] : []), ...rows().map(row => row.key)]) {
      itemRefs.push(refsByKey.get(key) as Renderable);
    }
    if (props.navRef) props.navRef.itemRefs = itemRefs;
  };
  const activateCurrentItem = () => {
    if (disposed) return false;
    const index = props.detailCursorIndex();
    if (props.scan && index === 1) {
      if (filter.editing()) filter.stop();
      else filter.start();
      return false;
    }
    filter.stop();
    if (index === 0) {
      if (!props.loading) void props.onScan();
      return false;
    }
    const row = rows()[index - 2];
    if (!row?.expandable) return false;
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
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
      previousQuery = "";
      filter.reset();
      setExpanded(defaultDependencyExpansion(projects()));
      setHoveredKey(null);
      props.setDetailCursorIndex(0);
      props.navRef?.scrollToCursor?.();
    });
  });

  createEffect(() => {
    const query = filter.query();
    if (query === previousQuery) return;
    previousQuery = query;
    untrack(() => {
      setExpanded(defaultDependencyExpansion(projects(), query));
      props.setDetailCursorIndex(1);
      props.navRef?.scrollToCursor?.();
    });
  });

  createEffect(() => {
    const count = rows().length + (props.scan ? 2 : 1);
    const cursor = untrack(props.detailCursorIndex);
    if (cursor < 0 || cursor >= count) props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  createEffect(() => {
    const count = rows().length + (props.scan ? 2 : 1);
    syncRefs();
    if (!props.navRef) return;
    props.navRef.itemCount = count;
    props.navRef.activateCurrentItem = activateCurrentItem;
  });

  createEffect(() => {
    const index = props.detailCursorIndex();
    const row = rows()[index - 2];
    if (!props.detailFocused()) {
      props.setDetailCursorAction(null);
      return;
    }
    if (index === 0) {
      props.setDetailCursorAction(props.loading ? null : props.scan ? "rescan" : "scan");
      return;
    }
    if (props.scan && index === 1) {
      props.setDetailCursorAction(filter.editing() ? "done" : "filter");
      return;
    }
    props.setDetailCursorAction(row?.expandable ? (row.expanded ? "collapse" : "expand") : null);
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
        <box height={1} flexShrink={0} />
        <SnykFilterRow
          filter={filter}
          selected={cursored(1)}
          mouseEnabled={props.mouseEnabled}
          rowRef={(element: Renderable) => {
            refsByKey.set("filter", element);
            itemRefs[1] = element;
          }}
          placeholder="Enter dependency filter..."
        />
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
        <Show when={projects().length > 0 && filter.query().trim() && tree().matchCount === 0}>
          <text fg={t().foregroundMuted} wrapMode="word">
            {`No matching dependencies${incompleteProjects().length > 0 || tree().filterIncomplete ? " · coverage incomplete" : ""}`}
          </text>
        </Show>
        <For each={rows()}>
          {(row, rowIndex) => {
            let element: Renderable | undefined;
            const index = () => rowIndex() + 2;
            onCleanup(() => {
              if (refsByKey.get(row.key) === element) refsByKey.delete(row.key);
            });
            return (
              <box flexDirection="column" width="100%" flexShrink={0}>
                <box
                  {...mouseRow(row.key, index)}
                  ref={(ref: Renderable) => {
                    element = ref;
                    refsByKey.set(row.key, ref);
                    itemRefs[index()] = ref;
                  }}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={background(row.key, index())}
                >
                  <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().border} wrapMode="none">
                    {prefix(row)}
                  </text>
                  <text
                    selectable={!props.mouseEnabled}
                    flexShrink={0}
                    fg={cursored(index()) ? t().accent : t().foregroundMuted}
                    wrapMode="none"
                  >
                    {row.expandable ? (row.expanded ? "▾ " : "▸ ") : "  "}
                  </text>
                  <text
                    selectable={!props.mouseEnabled}
                    flexGrow={1}
                    flexShrink={1}
                    fg={cursored(index()) ? t().accent : t().foreground}
                    wrapMode="none"
                    truncate
                  >
                    {label(row)}
                  </text>
                  <Show when={row.scope === "dev"}>
                    <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
                      {" dev"}
                    </text>
                  </Show>
                </box>
                <Show when={cursored(index()) && row.path.length > 0}>
                  <text fg={t().foregroundMuted} wrapMode="char" width="100%">
                    {`Path: ${row.path.join(" → ")}`}
                  </text>
                </Show>
              </box>
            );
          }}
        </For>
        <Show when={tree().truncated}>
          <text fg={t().foregroundMuted} wrapMode="word">
            Dependency tree truncated at 5,000 dependencies. Filter to narrow results.
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
