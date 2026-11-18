/**
 * OpenShift's Events tab: the warnings Kubernetes reported about a commit's resources, kept with the commit
 * (core/openshift/warnings.ts), as a tree (events-tree.ts): namespace, reason, then the resources it happened to.
 * Enter on a resource opens its events in the resource dialog, where the whole message is.
 */
import { createEffect, createMemo, createSignal, For, on, Show, untrack } from "solid-js";
import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import { heldResourceOf, type OpenShiftWarning, resourceOfWarning } from "../../../core/openshift/warnings";
import type { DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatRelativeDate } from "../../utils/date";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "../shared/detail-rows";
import { useDetailTree } from "../shared/detail-tree";
import { type RowShortcut, useOpenRowShortcut } from "../shared/open-row";
import { openShiftConsoleUrl } from "./console";
import { OPENSHIFT_EVENT_KINDS } from "./events";
import { type EventsRow, eventsTreeRows } from "./events-tree";

export interface OpenShiftEventsTabProps {
  sha: string;
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  /** Read the commit again (`Reload commit`): its resources and the warnings. */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  isLoading?: (sha: string) => boolean;
  /** How old the live list is (`live`). */
  liveAge?: () => string;
  /** Why it cannot load; null when it can. */
  unavailableReason?: string | null;
  /** An expired token stopped the live list until a Reload. */
  liveUnavailable?: boolean;
  /** The provider is fetching. */
  loading?: boolean;
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
  /** Web console URL from the settings; `o` opens the resource there when it is set. */
  consoleUrl?: () => string;
  /** Whether only the cache has the warning (OpenShift deleted it): its row says `(cached)`. */
  isCached?: (warning: OpenShiftWarning) => boolean;
  /** Whether the commit still has what the warning is about; a resource it no longer has says `(removed)`. */
  isPresent?: (warning: OpenShiftWarning) => boolean;
  /** Enter on a resource or a warning: the resource, with its events shown (only them, for a removed one). */
  onOpenResource?: (resource: OpenShiftResource, options: { eventsOnly: boolean }) => void;
}

const RELOAD = "reload";

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
  const toggle = (key: string) => {
    const next = new Set(collapsed());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    kept.collapsed = next;
    setCollapsed(next);
  };

  const data = () => props.getCommitData(props.sha);
  const warnings = () => data()?.warnings ?? [];
  const commitLoading = () => props.isLoading?.(props.sha) ?? false;
  const reloadBusy = () => commitLoading() || !!props.loading;
  // An expired token only stops automatic fetches; Reload commit stays the explicit retry, as in Resources.
  const reloadEnabled = () => !props.unavailableReason;

  const rows = createMemo(() =>
    eventsTreeRows(warnings(), {
      isPresent: warning => props.isPresent?.(warning) ?? true,
      isCached: warning => props.isCached?.(warning) ?? false,
      collapsed: collapsed(),
    }),
  );
  const byKey = createMemo(() => new Map(rows().map(row => [row.key, row])));
  /** The cursor's stops: Reload commit, then every row of the tree. */
  const keys = createMemo(() => [...(reloadEnabled() ? [RELOAD] : []), ...rows().map(row => row.key)]);
  const indexes = createMemo(() => new Map(keys().map((key, index) => [key, index])));
  const indexOf = (key: string) => indexes().get(key) ?? -1;
  const cursored = (key: string) => props.detailFocused() && props.detailCursorIndex() === indexOf(key);
  const current = (): EventsRow | typeof RELOAD | undefined => {
    const key = keys()[props.detailCursorIndex()];
    return key === RELOAD ? RELOAD : key ? byKey().get(key) : undefined;
  };
  /** The resource a row is about, when the resource dialog can show its events. */
  const openable = (warning: OpenShiftWarning) => {
    const resource = resourceOfWarning(warning, data());
    return resource && OPENSHIFT_EVENT_KINDS.has(resource.kind) ? resource : null;
  };

  createEffect(() => {
    const sha = props.sha;
    if (props.unavailableReason || props.liveUnavailable || commitLoading() || data()?.liveFetched) return;
    void props.fetchCommitData?.(sha);
  });

  // A refresh that adds or removes rows keeps the cursor on the row it was on.
  createEffect(
    on(keys, (next, previous) => {
      if (!previous) return;
      const key = previous[untrack(props.detailCursorIndex)];
      const index = key ? next.indexOf(key) : -1;
      if (index >= 0 && index !== untrack(props.detailCursorIndex)) props.setDetailCursorIndex(index);
    }),
  );

  const activate = () => {
    const row = current();
    if (row === RELOAD) {
      if (reloadEnabled() && !reloadBusy()) void props.fetchCommitData?.(props.sha, true);
    } else if (row?.kind === "namespace" || row?.kind === "reason") toggle(row.key);
    else if (row) {
      const resource = openable(row.warning);
      // Only its events when the commit holds nothing of it (a replaced pod); a pruned build opens from the cache.
      if (resource) props.onOpenResource?.(resource, { eventsOnly: !heldResourceOf(row.warning, data()) });
    }
    return false;
  };
  const mouse = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate,
    inert: key => key === RELOAD && (!reloadEnabled() || reloadBusy()),
  });
  const { mouseRow, hoverBg } = mouse;
  const tree = useDetailTree({
    navRef: props.navRef,
    keys,
    activate,
    detailCursorIndex: props.detailCursorIndex,
    setDetailCursorIndex: props.setDetailCursorIndex,
  });

  useOpenRowShortcut({
    navRef: props.navRef,
    detailFocused: props.detailFocused,
    url: () => {
      const row = current();
      const consoleUrl = props.consoleUrl?.() ?? "";
      if (!row || row === RELOAD) return null;
      if (row.kind === "namespace") return openShiftConsoleUrl(consoleUrl, { namespace: row.namespace });
      if (row.kind === "reason") return null;
      // A resource the cluster no longer has has no console page.
      const resource = row.removed ? null : openable(row.warning);
      return resource ? openShiftConsoleUrl(consoleUrl, { namespace: resource.namespace, resource }) : null;
    },
    setDetailCursorShortcut: props.setDetailCursorShortcut,
  });

  // Same wording as Resources: the row (re)loads this commit.
  const reloadLabel = () => (data() ? "Reload commit" : "Load commit");
  const reloadHint = () => (data() ? "reload" : "load");
  const reloadStatus = () => {
    if (props.liveUnavailable) return "";
    if (reloadBusy()) return BUSY.fetchingEvents;
    return props.liveAge?.() ?? "";
  };

  createEffect(() => {
    const row = current();
    if (!props.detailFocused() || !row) props.setDetailCursorAction(null);
    else if (row === RELOAD) props.setDetailCursorAction(reloadEnabled() && !reloadBusy() ? reloadHint() : null);
    else if (row.kind === "namespace" || row.kind === "reason")
      props.setDetailCursorAction(row.open ? "collapse" : "expand");
    else props.setDetailCursorAction(openable(row.warning) ? "events" : null);
  });

  const lead = (prefix: string) => (
    <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
      {prefix}
    </text>
  );
  /** A row's text: the cursor's accent, muted for a removed resource and its warnings. */
  const fg = (key: string, muted: boolean) =>
    cursored(key) ? t().accent : muted ? t().foregroundMuted : t().foreground;

  const renderRow = (row: EventsRow) => (
    <box
      {...mouseRow(row.key, () => indexOf(row.key))}
      ref={tree.ref(row.key)}
      flexDirection="row"
      width="100%"
      backgroundColor={cursored(row.key) ? t().backgroundElementActive : hoverBg(row.key)}
    >
      {lead(row.prefix)}
      {row.kind === "resource" ? (
        <>
          {/* The reason says what kind it is (BackOff: a pod); the dialog's title names it. */}
          <ScrollingLabel
            selectable={!props.mouseEnabled}
            text={row.name}
            tail={row.cached ? " (cached)" : ""}
            tailFg={t().foregroundMuted}
            active={cursored(row.key)}
            fg={fg(row.key, row.cached)}
            grow={false}
          />
          <box flexGrow={1} />
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {row.lastSeen ? `  ${formatRelativeDate(row.lastSeen)}` : ""}
          </text>
        </>
      ) : (
        <>
          <text
            selectable={!props.mouseEnabled}
            flexShrink={0}
            wrapMode="none"
            fg={cursored(row.key) ? t().accent : t().foregroundMuted}
          >
            {row.open ? "▾ " : "▸ "}
          </text>
          <ScrollingLabel
            selectable={!props.mouseEnabled}
            text={row.kind === "namespace" ? row.namespace : row.reason}
            active={cursored(row.key)}
            // The reason is what the tab is about: in the warning color, like the graph's count.
            fg={cursored(row.key) ? t().accent : row.kind === "reason" ? t().warning : t().foreground}
          />
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {String(row.count).padStart(3)}
          </text>
        </>
      )}
    </box>
  );

  return (
    <box flexDirection="column" width="100%">
      <ProviderActionRow
        label={reloadLabel()}
        status={reloadStatus()}
        disabled={!reloadEnabled()}
        cursored={cursored(RELOAD)}
        mouseEnabled={props.mouseEnabled}
        rows={mouse}
        rowKey={RELOAD}
        index={() => indexOf(RELOAD)}
        rowRef={tree.ref(RELOAD)}
      />
      {/* As Resources: the count once the commit is loaded, the tree when there is one. */}
      <Show when={!!data()}>
        <ProviderSummaryRow label="total events" count={warnings().length} />
        <For each={rows()}>{renderRow}</For>
      </Show>
    </box>
  );
}
