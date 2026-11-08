import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, on, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "../shared/detail-rows";
import { type StatusCategory, statusIcon } from "../shared/status";
import { openShiftStatusColor } from "./graph-columns";
import {
  isCachedOpenShiftResource,
  type OpenShiftCommitData,
  type OpenShiftResource,
  type OpenShiftStatus,
} from "./types";

export interface OpenShiftDetailTabProps {
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  sha: string;
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  isLoading?: (sha: string) => boolean;
  liveAge?: () => string;
  onOpenResource?: (resource: OpenShiftResource) => void;
  unavailableReason?: string | null;
  liveUnavailable?: boolean;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

type NamespaceData = OpenShiftCommitData["namespaces"][number];
type FlatItem =
  | { kind: "reload" }
  | { kind: "namespace"; namespace: string }
  | { kind: "resource"; resource: OpenShiftResource };
type ResourceListKey = keyof Pick<NamespaceData, "deployments" | "deploymentConfigs" | "pods" | "builds">;

const RESOURCE_GROUPS: { label: string; key: ResourceListKey }[] = [
  { label: "Deployments", key: "deployments" },
  { label: "DeploymentConfigs", key: "deploymentConfigs" },
  { label: "Pods", key: "pods" },
  { label: "Builds", key: "builds" },
];

function statusCategory(status: OpenShiftStatus): StatusCategory {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "running") return "running";
  return "unknown";
}

function statusMark(status: OpenShiftStatus) {
  return statusIcon(statusCategory(status));
}

function namespaceResources(ns: NamespaceData): OpenShiftResource[] {
  return [...ns.imageStreamTags, ...ns.deployments, ...ns.deploymentConfigs, ...ns.pods, ...ns.builds];
}

function imageStreamParts(resource: OpenShiftResource): { stream: string; tag: string } {
  const [stream, tag] = resource.name.split(":");
  return { stream: stream || resource.name, tag: tag || "latest" };
}

function groupedImageStreams(resources: OpenShiftResource[]): { stream: string; tags: OpenShiftResource[] }[] {
  const groups = new Map<string, OpenShiftResource[]>();
  for (const resource of resources) {
    const { stream } = imageStreamParts(resource);
    groups.set(stream, [...(groups.get(stream) ?? []), resource]);
  }
  return [...groups.entries()]
    .map(([stream, tags]) => ({
      stream,
      tags: tags.sort((a, b) => imageStreamParts(a).tag.localeCompare(imageStreamParts(b).tag)),
    }))
    .sort((a, b) => a.stream.localeCompare(b.stream));
}

function compactResourceName(resource: OpenShiftResource): string {
  if (resource.kind === "ImageStreamTag") return imageStreamParts(resource).tag;
  return resource.name;
}

function resourcesForFlatItems(ns: NamespaceData): OpenShiftResource[] {
  return [
    ...RESOURCE_GROUPS.flatMap(group => ns[group.key]),
    ...groupedImageStreams(ns.imageStreamTags).flatMap(group => group.tags),
  ];
}

export function OpenShiftDetailTab(props: Readonly<OpenShiftDetailTabProps>) {
  const t = useT();
  const data = () => props.getCommitData(props.sha);
  const commitLoading = () => props.isLoading?.(props.sha) ?? false;
  const reloadBusy = () => commitLoading() || !!props.loading;
  const liveUnavailable = () => !!props.liveUnavailable;
  // An expired token only stops automatic fetches (below); Reload commit stays available as the explicit retry.
  const reloadEnabled = () => !props.unavailableReason;
  const liveAge = () => props.liveAge?.() ?? "";
  const [expandedNamespaces, setExpandedNamespaces] = createSignal<Set<string>>(new Set());
  const itemRefs: Renderable[] = [];
  const refsByKey = new Map<string, Renderable>();
  const rows = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate: () => activateCurrentItem(),
    inert: key => key === "reload" && (!reloadEnabled() || reloadBusy()),
  });
  const { mouseRow, hoverBg } = rows;

  const flatItemKey = (item: FlatItem) => {
    if (item.kind === "reload") return "reload";
    return item.kind === "namespace" ? `namespace:${item.namespace}` : `resource:${item.resource.id}`;
  };

  const syncItemRefs = () => {
    const items = flatItems();
    itemRefs.length = items.length;
    items.forEach((item, index) => {
      itemRefs[index] = refsByKey.get(flatItemKey(item)) as Renderable;
    });
    if (props.navRef) props.navRef.itemRefs = itemRefs;
  };

  const namespaces = createMemo(() => data()?.namespaces ?? []);
  const resources = createMemo(() => namespaces().flatMap(namespaceResources));
  // Same wording as the CI tabs: the row (re)loads this commit's resources.
  const reloadLabel = () => (data() ? "Reload commit" : "Load commit");
  const reloadHint = () => (data() ? "reload" : "load");

  const flatItems = createMemo<FlatItem[]>(() => [
    ...(reloadEnabled() ? [{ kind: "reload" as const }] : []),
    ...namespaces().flatMap(ns => [
      { kind: "namespace" as const, namespace: ns.namespace },
      ...(expandedNamespaces().has(ns.namespace)
        ? resourcesForFlatItems(ns).map(resource => ({ kind: "resource" as const, resource }))
        : []),
    ]),
  ]);

  const flatIndexForNamespace = (namespace: string) =>
    flatItems().findIndex(item => item.kind === "namespace" && item.namespace === namespace);

  const flatIndexForResource = (resource: OpenShiftResource) =>
    flatItems().findIndex(item => item.kind === "resource" && item.resource.id === resource.id);

  const toggleNamespace = (namespace: string) => {
    setExpandedNamespaces(prev => {
      const next = new Set(prev);
      if (next.has(namespace)) next.delete(namespace);
      else next.add(namespace);
      return next;
    });
  };

  createEffect(() => {
    const sha = props.sha;
    if (props.unavailableReason || liveUnavailable() || commitLoading() || data()?.liveFetched) return;
    void props.fetchCommitData?.(sha);
  });

  // A new commit opens every namespace with the cursor on top. Live updates for the same commit keep the
  // user's open/closed choices (new namespaces open) and keep the cursor on the same row.
  let expansionSha: string | null = null;
  let knownNamespaces = new Set<string>();
  createEffect(() => {
    const sha = props.sha;
    const names = namespaces().map(ns => ns.namespace);
    if (sha !== expansionSha) {
      expansionSha = sha;
      knownNamespaces = new Set(names);
      setExpandedNamespaces(new Set(names));
      props.setDetailCursorIndex(0);
      return;
    }
    const added = names.filter(name => !knownNamespaces.has(name));
    knownNamespaces = new Set(names);
    if (added.length > 0) setExpandedNamespaces(prev => new Set([...prev, ...added]));
  });

  let cursorSha: string | null = null;
  createEffect(
    on(flatItems, (items, previous) => {
      const sha = untrack(() => props.sha);
      if (sha !== cursorSha || !previous) {
        cursorSha = sha;
        return;
      }
      const index = untrack(() => props.detailCursorIndex());
      const before = previous[index];
      if (!before) return;
      const key = flatItemKey(before);
      const next = items.findIndex(item => flatItemKey(item) === key);
      if (next >= 0 && next !== index) props.setDetailCursorIndex(next);
    }),
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
    if (item.kind === "reload") {
      if (reloadEnabled() && !reloadBusy()) void props.fetchCommitData?.(props.sha, true);
    } else if (item.kind === "namespace") toggleNamespace(item.namespace);
    else props.onOpenResource?.(item.resource);
    return false;
  };

  createEffect(() => {
    if (!props.navRef) return;
    const items = flatItems();
    props.navRef.itemCount = items.length;
    syncItemRefs();
    props.navRef.activateCurrentItem = activateCurrentItem;
  });

  createEffect(() => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!props.detailFocused() || !item) {
      props.setDetailCursorAction(null);
      return;
    }
    if (item.kind === "reload") props.setDetailCursorAction(reloadEnabled() && !reloadBusy() ? reloadHint() : null);
    else if (item.kind === "namespace")
      props.setDetailCursorAction(expandedNamespaces().has(item.namespace) ? "collapse" : "expand");
    else props.setDetailCursorAction("open");
  });

  const renderResourceRow = (resource: OpenShiftResource, lead: string, connector: string) => {
    const idx = () => flatIndexForResource(resource);
    const isCursored = () => props.detailFocused() && props.detailCursorIndex() === idx();
    const color = () => openShiftStatusColor(t(), resource.status);
    const textColor = () => (isCursored() ? t().accent : t().foreground);
    return (
      <box
        {...mouseRow(`resource:${resource.id}`, idx)}
        ref={(el: Renderable) => {
          refsByKey.set(`resource:${resource.id}`, el);
          syncItemRefs();
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={isCursored() ? t().backgroundElementActive : hoverBg(`resource:${resource.id}`)}
      >
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
          {lead}
          {connector}
        </text>
        <ScrollingLabel
          selectable={!props.mouseEnabled}
          text={compactResourceName(resource)}
          active={isCursored()}
          fg={textColor()}
          grow={false}
        />
        <Show when={isCachedOpenShiftResource(resource)}>
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" (cached)"}
          </text>
        </Show>
        <box flexGrow={1} />
        <text selectable={!props.mouseEnabled} flexShrink={0} width={2} wrapMode="none" fg={color()}>
          {statusMark(resource.status).padStart(2)}
        </text>
      </box>
    );
  };

  const reloadIdx = () => flatItems().findIndex(item => item.kind === "reload");
  const isReloadCursored = () => reloadIdx() >= 0 && props.detailFocused() && props.detailCursorIndex() === reloadIdx();
  const reloadStatus = () => {
    if (liveUnavailable()) return "";
    if (reloadBusy()) return BUSY.fetchingResources;
    return liveAge();
  };

  return (
    <box flexDirection="column" width="100%">
      <ProviderActionRow
        label={reloadLabel()}
        status={reloadStatus()}
        disabled={!reloadEnabled()}
        cursored={isReloadCursored()}
        mouseEnabled={props.mouseEnabled}
        rows={rows}
        rowKey="reload"
        index={reloadIdx}
        rowRef={el => {
          refsByKey.set("reload", el);
          syncItemRefs();
        }}
      />
      <Show when={!!data()}>
        <ProviderSummaryRow label="total resources" count={resources().length} />
      </Show>
      <Show when={resources().length > 0}>
        <box flexDirection="column" width="100%">
          <For each={namespaces()}>
            {(ns, nsIdx) => {
              const nsResources = () => namespaceResources(ns);
              const namespaceIdx = () => flatIndexForNamespace(ns.namespace);
              const isNamespaceCursored = () => props.detailFocused() && props.detailCursorIndex() === namespaceIdx();
              const namespaceIsExpanded = () => expandedNamespaces().has(ns.namespace);
              const namespaceIsLast = () => nsIdx() === namespaces().length - 1;
              const namespaceConnector = () => (namespaceIsLast() ? "└─ " : "├─ ");
              const childLead = () => (namespaceIsLast() ? "   " : "│  ");

              return (
                <box flexDirection="column" width="100%">
                  <box
                    {...mouseRow(`namespace:${ns.namespace}`, namespaceIdx)}
                    ref={(el: Renderable) => {
                      refsByKey.set(`namespace:${ns.namespace}`, el);
                      syncItemRefs();
                    }}
                    flexDirection="row"
                    width="100%"
                    backgroundColor={
                      isNamespaceCursored() ? t().backgroundElementActive : hoverBg(`namespace:${ns.namespace}`)
                    }
                  >
                    <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                      {namespaceConnector()}
                    </text>
                    <text
                      selectable={!props.mouseEnabled}
                      flexShrink={0}
                      wrapMode="none"
                      fg={isNamespaceCursored() ? t().accent : t().foregroundMuted}
                    >
                      {namespaceIsExpanded() ? "▾ " : "▸ "}
                    </text>
                    <ScrollingLabel
                      selectable={!props.mouseEnabled}
                      text={ns.namespace}
                      active={isNamespaceCursored()}
                      fg={isNamespaceCursored() ? t().accent : t().foreground}
                    />
                    <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {String(nsResources().length).padStart(3)}
                    </text>
                  </box>

                  <Show when={namespaceIsExpanded()}>
                    {/* Kind groups, then ImageStreams; the last one closes the tree with └─ like CI runs do. */}
                    <For each={RESOURCE_GROUPS.filter(group => ns[group.key].length > 0)}>
                      {(group, groupIdx) => {
                        const groupIsLast = () =>
                          ns.imageStreamTags.length === 0 &&
                          groupIdx() === RESOURCE_GROUPS.filter(entry => ns[entry.key].length > 0).length - 1;
                        return (
                          <>
                            <box flexDirection="row" width="100%">
                              <text flexShrink={0} wrapMode="none" fg={t().border}>
                                {childLead()}
                                {groupIsLast() ? "└─ " : "├─ "}
                              </text>
                              <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                                {group.label}
                              </text>
                            </box>
                            <For each={ns[group.key]}>
                              {(resource, resourceIdx) =>
                                renderResourceRow(
                                  resource,
                                  `${childLead()}${groupIsLast() ? "   " : "│  "}`,
                                  resourceIdx() === ns[group.key].length - 1 ? "└─ " : "├─ ",
                                )
                              }
                            </For>
                          </>
                        );
                      }}
                    </For>

                    <Show when={ns.imageStreamTags.length > 0}>
                      <box flexDirection="row" width="100%">
                        <text flexShrink={0} wrapMode="none" fg={t().border}>
                          {childLead()}└─{" "}
                        </text>
                        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                          ImageStreams
                        </text>
                      </box>
                      <For each={groupedImageStreams(ns.imageStreamTags)}>
                        {(stream, streamIdx) => {
                          const streamIsLast = () => streamIdx() === groupedImageStreams(ns.imageStreamTags).length - 1;
                          // ImageStreams is always the last group, so its children hang off blank space.
                          const streamLead = () => `${childLead()}   `;
                          return (
                            <box flexDirection="column" width="100%">
                              <box flexDirection="row" width="100%">
                                <text flexShrink={0} wrapMode="none" fg={t().border}>
                                  {streamLead()}
                                  {streamIsLast() ? "└─ " : "├─ "}
                                </text>
                                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                                  {stream.stream}
                                </text>
                              </box>
                              <For each={stream.tags}>
                                {(tag, tagIdx) =>
                                  renderResourceRow(
                                    tag,
                                    `${streamLead()}${streamIsLast() ? "   " : "│  "}`,
                                    tagIdx() === stream.tags.length - 1 ? "└─ " : "├─ ",
                                  )
                                }
                              </For>
                            </box>
                          );
                        }}
                      </For>
                    </Show>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
      </Show>
    </box>
  );
}
