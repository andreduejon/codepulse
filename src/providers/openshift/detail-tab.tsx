import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { type StatusCategory, statusColor, statusIcon } from "../shared/status";
import type { OpenShiftCommitData, OpenShiftResource, OpenShiftStatus } from "./types";

export interface OpenShiftDetailTabProps {
  sha: string;
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  fetchCommitData?: (sha: string) => Promise<void>;
  onOpenResource?: (resource: OpenShiftResource) => void;
  unavailableReason?: string | null;
  warningReason?: string | null;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

type NamespaceData = OpenShiftCommitData["namespaces"][number];
type FlatItem = { kind: "namespace"; namespace: string } | { kind: "resource"; resource: OpenShiftResource };
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
  const [requestedSha, setRequestedSha] = createSignal<string | null>(null);
  const [expandedNamespaces, setExpandedNamespaces] = createSignal<Set<string>>(new Set());
  const itemRefs: Renderable[] = [];
  const refsByKey = new Map<string, Renderable>();

  const flatItemKey = (item: FlatItem) =>
    item.kind === "namespace" ? `namespace:${item.namespace}` : `resource:${item.resource.id}`;

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

  const flatItems = createMemo<FlatItem[]>(() =>
    namespaces().flatMap(ns => [
      { kind: "namespace" as const, namespace: ns.namespace },
      ...(expandedNamespaces().has(ns.namespace)
        ? resourcesForFlatItems(ns).map(resource => ({ kind: "resource" as const, resource }))
        : []),
    ]),
  );

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
    if (props.loading || data()?.resolved || requestedSha() === sha) return;
    setRequestedSha(sha);
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

  createEffect(() => {
    if (!props.navRef) return;
    const items = flatItems();
    props.navRef.itemCount = items.length;
    syncItemRefs();
    props.navRef.activateCurrentItem = () => {
      const item = flatItems()[props.detailCursorIndex()];
      if (!item) return false;
      if (item.kind === "namespace") toggleNamespace(item.namespace);
      else props.onOpenResource?.(item.resource);
      return false;
    };
  });

  createEffect(() => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!props.detailFocused() || !item) {
      props.setDetailCursorAction(null);
      return;
    }
    if (item.kind === "namespace")
      props.setDetailCursorAction(expandedNamespaces().has(item.namespace) ? "collapse" : "expand");
    else props.setDetailCursorAction("open");
  });

  const renderFallback = (text: string) => (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={t().foregroundMuted}>{text}</text>
    </box>
  );

  const renderResourceRow = (resource: OpenShiftResource, lead: string, connector: string) => {
    const idx = () => flatIndexForResource(resource);
    const isCursored = () => props.detailFocused() && props.detailCursorIndex() === idx();
    const color = () => statusColor(t(), statusCategory(resource.status));
    const textColor = () => (isCursored() ? t().accent : t().foreground);
    return (
      <box
        ref={(el: Renderable) => {
          refsByKey.set(`resource:${resource.id}`, el);
          syncItemRefs();
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={isCursored() ? t().backgroundElementActive : undefined}
      >
        <text flexShrink={0} wrapMode="none" fg={t().border}>
          {lead}
          {connector}
        </text>
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={textColor()}>
          {compactResourceName(resource)}
        </text>
        <text flexShrink={0} width={2} wrapMode="none" fg={color()}>
          {statusMark(resource.status).padStart(2)}
        </text>
      </box>
    );
  };

  return (
    <Show when={!props.unavailableReason} fallback={renderFallback("Unavailable")}>
      <Show when={!props.loading} fallback={renderFallback("Loading OpenShift inventory…")}>
        <Show when={resources().length > 0} fallback={renderFallback("No OpenShift resources for this commit")}>
          <box flexDirection="column" width="100%">
            <Show when={props.warningReason}>
              {warning => (
                <box paddingBottom={1}>
                  <text fg={t().accent} wrapMode="word">
                    {warning()}
                  </text>
                </box>
              )}
            </Show>
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
                      ref={(el: Renderable) => {
                        refsByKey.set(`namespace:${ns.namespace}`, el);
                        syncItemRefs();
                      }}
                      flexDirection="row"
                      width="100%"
                      backgroundColor={isNamespaceCursored() ? t().backgroundElementActive : undefined}
                    >
                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                        {namespaceConnector()}
                      </text>
                      <text
                        flexShrink={0}
                        wrapMode="none"
                        fg={isNamespaceCursored() ? t().accent : t().foregroundMuted}
                      >
                        {namespaceIsExpanded() ? "▾ " : "▸ "}
                      </text>
                      <text
                        flexGrow={1}
                        flexShrink={1}
                        wrapMode="none"
                        truncate
                        fg={isNamespaceCursored() ? t().accent : t().foreground}
                      >
                        {ns.namespace}
                      </text>
                      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
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
      </Show>
    </Show>
  );
}
