import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { type StatusCategory, statusColor, statusIcon } from "../shared/status";
import type {
  OpenShiftCommitData,
  OpenShiftDetailGroup,
  OpenShiftResource,
  OpenShiftResourceDetailResult,
  OpenShiftStatus,
} from "./types";

export interface OpenShiftDetailTabProps {
  sha: string;
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  fetchCommitData?: (sha: string) => Promise<void>;
  fetchResourceDetails?: (resource: OpenShiftResource, signal?: AbortSignal) => Promise<OpenShiftResourceDetailResult>;
  unavailableReason?: string | null;
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
  const [selectedResource, setSelectedResource] = createSignal<OpenShiftResource | null>(null);
  const [detailGroups, setDetailGroups] = createSignal<OpenShiftDetailGroup[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);
  let detailRequest: AbortController | null = null;
  const itemRefs: Renderable[] = [];

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

  const openResource = (resource: OpenShiftResource) => {
    detailRequest?.abort();
    setSelectedResource(resource);
    setDetailGroups([]);
    setDetailError(null);
    if (!props.fetchResourceDetails) return;
    const request = new AbortController();
    detailRequest = request;
    setDetailLoading(true);
    void props.fetchResourceDetails(resource, request.signal).then(
      result => {
        if (request.signal.aborted || detailRequest !== request) return;
        setDetailGroups(result.groups);
        setDetailError(result.error);
        setDetailLoading(false);
      },
      error => {
        if (request.signal.aborted || detailRequest !== request) return;
        setDetailError(error instanceof Error ? error.message : String(error));
        setDetailLoading(false);
      },
    );
  };

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

  onCleanup(() => detailRequest?.abort());

  createEffect(() => {
    props.sha;
    detailRequest?.abort();
    detailRequest = null;
    setSelectedResource(null);
    setDetailGroups([]);
    setDetailError(null);
    setDetailLoading(false);
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
    props.navRef.itemCount = flatItems().length;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = () => {
      const item = flatItems()[props.detailCursorIndex()];
      if (!item) return false;
      if (item.kind === "namespace") toggleNamespace(item.namespace);
      else openResource(item.resource);
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
          const itemIdx = idx();
          if (itemIdx >= 0) itemRefs[itemIdx] = el;
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
                        const itemIdx = namespaceIdx();
                        if (itemIdx >= 0) itemRefs[itemIdx] = el;
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
            <Show when={selectedResource()}>
              {resource => (
                <box flexDirection="column" width="100%">
                  <text fg={t().accent}>
                    {resource().kind} {resource().name}
                  </text>
                  <Show when={detailLoading()}>
                    <text fg={t().foregroundMuted}>Loading...</text>
                  </Show>
                  <Show when={!detailLoading() && detailError()}>
                    {error => <text fg={t().foregroundMuted}>{error()}</text>}
                  </Show>
                  <For each={detailGroups()}>
                    {group => (
                      <box flexDirection="column" width="100%">
                        <text fg={statusColor(t(), statusCategory(group.status))}>{group.name}</text>
                        <For each={group.lines}>
                          {line => (
                            <text fg={statusColor(t(), statusCategory(line.status))}>
                              {" "}
                              {statusMark(line.status)} {line.text}
                            </text>
                          )}
                        </For>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </Show>
          </box>
        </Show>
      </Show>
    </Show>
  );
}
