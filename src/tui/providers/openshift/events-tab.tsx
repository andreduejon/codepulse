/**
 * OpenShift's Events tab: the warnings Kubernetes reported about a commit's resources, kept with the commit
 * (core/openshift/warnings.ts). By namespace, newest first, one line each; Enter opens its resource's events in the
 * resource dialog, where the whole message is.
 */
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import { type OpenShiftWarning, resourceOfWarning } from "../../../core/openshift/warnings";
import type { DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import { ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "../shared/detail-rows";
import { useDetailTree } from "../shared/detail-tree";
import { type RowShortcut, useOpenRowShortcut } from "../shared/open-row";
import { openShiftConsoleUrl } from "./console";
import { OPENSHIFT_EVENT_KINDS } from "./events";

export interface OpenShiftEventsTabProps {
  sha: string;
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  /** Keeps closed namespaces while the tab is not shown (another tab, the other layout). */
  memory?: DetailMemory;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
  /** Web console URL from the settings; `o` opens the warning's resource there when it is set. */
  consoleUrl?: () => string;
  /** Enter on a warning: its resource, with its events shown. */
  onOpenResource?: (resource: OpenShiftResource) => void;
}

export const OPENSHIFT_NO_WARNINGS = "No warnings about this commit's resources.";

type FlatItem = { kind: "namespace"; namespace: string } | { kind: "warning"; warning: OpenShiftWarning };

/** Whether the resource dialog can show the warning's resource: a ReplicaSet or ReplicationController it cannot. */

const itemKey = (item: FlatItem) =>
  item.kind === "namespace" ? `namespace:${item.namespace}` : `warning:${item.warning.id}`;

/** The namespaces closed in one commit. */
interface EventsMemory {
  sha: string | null;
  collapsed: Set<string>;
}

const newEventsMemory = (): EventsMemory => ({ sha: null, collapsed: new Set() });

export function OpenShiftEventsTab(props: Readonly<OpenShiftEventsTabProps>) {
  const t = useT();
  const kept = props.memory?.("events", newEventsMemory) ?? newEventsMemory();
  const [collapsed, setCollapsed] = createSignal<Set<string>>(
    kept.sha === untrack(() => props.sha) ? kept.collapsed : new Set(),
  );
  // Another commit opens every namespace.
  createEffect(() => {
    const sha = props.sha;
    if (kept.sha === sha) return;
    kept.sha = sha;
    kept.collapsed = new Set();
    setCollapsed(kept.collapsed);
  });
  const toggle = (namespace: string) => {
    const next = new Set(collapsed());
    if (next.has(namespace)) next.delete(namespace);
    else next.add(namespace);
    kept.collapsed = next;
    setCollapsed(next);
  };

  const warnings = () => props.getCommitData(props.sha)?.warnings ?? [];
  // Namespaces by name, so a new warning never moves them; each one's warnings newest first.
  const namespaces = createMemo(() => {
    const byNamespace = new Map<string, OpenShiftWarning[]>();
    for (const entry of warnings()) {
      const list = byNamespace.get(entry.namespace) ?? [];
      list.push(entry);
      byNamespace.set(entry.namespace, list);
    }
    return [...byNamespace.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, list]) => ({
        namespace,
        warnings: list.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")),
      }));
  });
  const flatItems = createMemo<FlatItem[]>(() =>
    namespaces().flatMap(ns => [
      { kind: "namespace" as const, namespace: ns.namespace },
      ...(collapsed().has(ns.namespace) ? [] : ns.warnings.map(warning => ({ kind: "warning" as const, warning }))),
    ]),
  );
  const indexes = createMemo(() => new Map(flatItems().map((item, index) => [itemKey(item), index])));
  const indexOf = (key: string) => indexes().get(key) ?? -1;
  const cursored = (key: string) => props.detailFocused() && props.detailCursorIndex() === indexOf(key);
  const current = () => flatItems()[props.detailCursorIndex()];
  /** The resource a warning is about, when the resource dialog can show its events. */
  const openable = (warning: OpenShiftWarning) => {
    const resource = resourceOfWarning(warning, props.getCommitData(props.sha));
    return resource && OPENSHIFT_EVENT_KINDS.has(resource.kind) ? resource : null;
  };

  const activate = () => {
    const item = current();
    if (item?.kind === "namespace") toggle(item.namespace);
    else if (item) {
      const resource = openable(item.warning);
      if (resource) props.onOpenResource?.(resource);
    }
    return false;
  };
  const rows = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate,
  });
  const { mouseRow, hoverBg } = rows;
  const tree = useDetailTree({
    navRef: props.navRef,
    keys: () => flatItems().map(itemKey),
    activate,
    detailCursorIndex: props.detailCursorIndex,
    setDetailCursorIndex: props.setDetailCursorIndex,
  });

  useOpenRowShortcut({
    navRef: props.navRef,
    detailFocused: props.detailFocused,
    url: () => {
      const item = current();
      const consoleUrl = props.consoleUrl?.() ?? "";
      if (item?.kind === "namespace") return openShiftConsoleUrl(consoleUrl, { namespace: item.namespace });
      const resource = item?.kind === "warning" ? openable(item.warning) : null;
      return resource ? openShiftConsoleUrl(consoleUrl, { namespace: resource.namespace, resource }) : null;
    },
    setDetailCursorShortcut: props.setDetailCursorShortcut,
  });

  createEffect(() => {
    const item = current();
    if (!props.detailFocused() || !item) props.setDetailCursorAction(null);
    else if (item.kind === "namespace")
      props.setDetailCursorAction(collapsed().has(item.namespace) ? "expand" : "collapse");
    else props.setDetailCursorAction(openable(item.warning) ? "events" : null);
  });

  const renderWarning = (warning: OpenShiftWarning, lead: string, last: boolean) => {
    const key = `warning:${warning.id}`;
    const isCursored = () => cursored(key);
    return (
      <box
        {...mouseRow(key, () => indexOf(key))}
        ref={tree.ref(key)}
        flexDirection="row"
        width="100%"
        backgroundColor={isCursored() ? t().backgroundElementActive : hoverBg(key)}
      >
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
          {lead}
          {last ? "└─ " : "├─ "}
        </text>
        <ScrollingLabel
          selectable={!props.mouseEnabled}
          text={warning.reason}
          tail={`  ${warning.kind} ${warning.name}`}
          tailFg={t().foregroundMuted}
          active={isCursored()}
          fg={isCursored() ? t().accent : t().foreground}
          grow={false}
        />
        <box flexGrow={1} />
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {warning.lastSeen ? `  ${formatRelativeDate(warning.lastSeen)}` : ""}
        </text>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%">
      <Show
        when={warnings().length > 0}
        fallback={
          <text fg={t().foregroundMuted} wrapMode="word">
            {OPENSHIFT_NO_WARNINGS}
          </text>
        }
      >
        <ProviderSummaryRow label="total warnings" count={warnings().length} />
        <For each={namespaces()}>
          {(ns, nsIndex) => {
            const key = `namespace:${ns.namespace}`;
            const isCursored = () => cursored(key);
            const last = () => nsIndex() === namespaces().length - 1;
            const open = () => !collapsed().has(ns.namespace);
            return (
              <box flexDirection="column" width="100%">
                <box
                  {...mouseRow(key, () => indexOf(key))}
                  ref={tree.ref(key)}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={isCursored() ? t().backgroundElementActive : hoverBg(key)}
                >
                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                    {last() ? "└─ " : "├─ "}
                  </text>
                  <text
                    selectable={!props.mouseEnabled}
                    flexShrink={0}
                    wrapMode="none"
                    fg={isCursored() ? t().accent : t().foregroundMuted}
                  >
                    {open() ? "▾ " : "▸ "}
                  </text>
                  <ScrollingLabel
                    selectable={!props.mouseEnabled}
                    text={ns.namespace}
                    active={isCursored()}
                    fg={isCursored() ? t().accent : t().foreground}
                  />
                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {String(ns.warnings.length).padStart(3)}
                  </text>
                </box>
                <Show when={open()}>
                  <For each={ns.warnings}>
                    {(warning, index) =>
                      renderWarning(warning, last() ? "   " : "│  ", index() === ns.warnings.length - 1)
                    }
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
