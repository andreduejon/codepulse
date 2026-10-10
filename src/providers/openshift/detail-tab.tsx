import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
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
  warningReason?: string | null;
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
  const reloadEnabled = () => !liveUnavailable() && !props.unavailableReason;
  const liveAge = () => props.liveAge?.() ?? "";
  const [expandedNamespaces, setExpandedNamespaces] = createSignal<Set<string>>(new Set());
  const itemRefs: Renderable[] = [];
  const refsByKey = new Map<string, Renderable>();
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const mouseRow = (key: string, index: () => number) => ({
    onMouseOver: () => setHoveredKey(key),
    onMouseOut: () => setHoveredKey(null),
    onMouseDown: (event: MouseEvent) => {
      if (!props.mouseEnabled || event.button !== MouseButton.LEFT) return;
      event.preventDefault();
      event.stopPropagation();
      if (index() < 0) return;
      if (key === "reload" && (!reloadEnabled() || reloadBusy())) return;
      props.onMouseFocus?.();
      props.setDetailCursorIndex(index());
      activateCurrentItem();
    },
  });
  const hoverBg = (key: string) =>
    props.mouseEnabled && hoveredKey() === key && (key !== "reload" || (reloadEnabled() && !reloadBusy()))
      ? t().backgroundElement
      : undefined;

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
  const reloadLabel = () => (data() ? "Reload resources" : "Load resources");
  const reloadHint = () => (reloadLabel() === "Load resources" ? "load" : "reload");

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

  createEffect(() => {
    props.sha;
    const names = namespaces().map(ns => ns.namespace);
    setExpandedNamespaces(new Set(names));
    props.setDetailCursorIndex(0);
  });

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
        <text selectable={!props.mouseEnabled} flexShrink={1} wrapMode="none" truncate fg={textColor()}>
          {compactResourceName(resource)}
        </text>
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
    if (reloadBusy()) return "loading...";
    return liveAge();
  };

  return (
    <box flexDirection="column" width="100%">
      <box
        {...mouseRow("reload", reloadIdx)}
        ref={(el: Renderable) => {
          refsByKey.set("reload", el);
          syncItemRefs();
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={isReloadCursored() ? t().backgroundElementActive : hoverBg("reload")}
      >
        <text
          selectable={!props.mouseEnabled}
          flexGrow={1}
          fg={!reloadEnabled() ? t().foregroundMuted : isReloadCursored() ? t().accent : t().foreground}
          wrapMode="none"
        >
          {reloadLabel()}
        </text>
        <Show when={reloadStatus()}>
          <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
            {reloadStatus()}
          </text>
        </Show>
      </box>
      <Show when={!!data()}>
        <box flexDirection="row" width="100%">
          <box flexGrow={1}>
            <text fg={t().foregroundMuted} wrapMode="none">
              total resources
            </text>
          </box>
          <box flexShrink={0} width={2} />
          <text fg={t().foregroundMuted} wrapMode="none">
            {resources().length}
          </text>
        </box>
      </Show>
      <Show when={props.warningReason}>
        {warning => (
          <box paddingBottom={1}>
            <text fg={t().accent} wrapMode="word">
              {warning()}
            </text>
          </box>
        )}
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
                    <text
                      selectable={!props.mouseEnabled}
                      flexGrow={1}
                      flexShrink={1}
                      wrapMode="none"
                      truncate
                      fg={isNamespaceCursored() ? t().accent : t().foreground}
                    >
                      {ns.namespace}
                    </text>
                    <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {String(nsResources().length).padStart(3)}
                    </text>
                  </box>

                  <Show when={namespaceIsExpanded()}>
                    <For each={RESOURCE_GROUPS}>
                      {group => (
                        <Show when={ns[group.key].length > 0}>
                          <box flexDirection="row" width="100%">
                            <text flexShrink={0} wrapMode="none" fg={t().border}>
                              {childLead()}├─{" "}
                            </text>
                            <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                              {group.label}
                            </text>
                          </box>
                          <For each={ns[group.key]}>
                            {(resource, resourceIdx) =>
                              renderResourceRow(
                                resource,
                                `${childLead()}│  `,
                                resourceIdx() === ns[group.key].length - 1 ? "└─ " : "├─ ",
                              )
                            }
                          </For>
                        </Show>
                      )}
                    </For>

                    <Show when={ns.imageStreamTags.length > 0}>
                      <box flexDirection="row" width="100%">
                        <text flexShrink={0} wrapMode="none" fg={t().border}>
                          {childLead()}├─{" "}
                        </text>
                        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                          ImageStreams
                        </text>
                      </box>
                      <For each={groupedImageStreams(ns.imageStreamTags)}>
                        {(stream, streamIdx) => {
                          const streamLead = () =>
                            childLead() +
                            (streamIdx() === groupedImageStreams(ns.imageStreamTags).length - 1 ? "   " : "│  ");
                          return (
                            <box flexDirection="column" width="100%">
                              <box flexDirection="row" width="100%">
                                <text flexShrink={0} wrapMode="none" fg={t().border}>
                                  {streamLead()}├─{" "}
                                </text>
                                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                                  {stream.stream}
                                </text>
                              </box>
                              <For each={stream.tags}>
                                {(tag, tagIdx) =>
                                  renderResourceRow(
                                    tag,
                                    `${streamLead()}│  `,
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
