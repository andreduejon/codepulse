import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
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
  fetchResourceDetails?: (resource: OpenShiftResource) => Promise<OpenShiftResourceDetailResult>;
  unavailableReason?: string | null;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

type FlatItem = { resource: OpenShiftResource; flatIndex: number };

const RESOURCE_GROUPS: {
  label: string;
  key: keyof Pick<
    OpenShiftCommitData["namespaces"][number],
    "builds" | "imageStreamTags" | "deployments" | "deploymentConfigs" | "pods"
  >;
}[] = [
  { label: "Builds", key: "builds" },
  { label: "ImageStreamTags", key: "imageStreamTags" },
  { label: "Deployments", key: "deployments" },
  { label: "DeploymentConfigs", key: "deploymentConfigs" },
  { label: "Pods", key: "pods" },
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

function resourceLabel(resource: OpenShiftResource) {
  return `${resource.kind} ${resource.name}`;
}

export function OpenShiftDetailTab(props: Readonly<OpenShiftDetailTabProps>) {
  const t = useT();
  const data = () => props.getCommitData(props.sha);
  const [requestedSha, setRequestedSha] = createSignal<string | null>(null);
  const [expandedResources, setExpandedResources] = createSignal<Set<string>>(new Set());
  const [loadingResources, setLoadingResources] = createSignal<Set<string>>(new Set());
  const [loadedResources, setLoadedResources] = createSignal<Set<string>>(new Set());
  const [detailGroups, setDetailGroups] = createSignal<Map<string, OpenShiftDetailGroup[]>>(new Map());
  const [detailUnavailable, setDetailUnavailable] = createSignal<Set<string>>(new Set());
  const itemRefs: Renderable[] = [];

  const resources = createMemo(
    () => data()?.namespaces.flatMap(ns => RESOURCE_GROUPS.flatMap(group => ns[group.key])) ?? [],
  );

  const flatItems = createMemo<FlatItem[]>(() => resources().map((resource, idx) => ({ resource, flatIndex: idx })));

  const resourceIndex = (resource: OpenShiftResource) =>
    flatItems().findIndex(item => item.resource.id === resource.id);

  const toggleResource = (resource: OpenShiftResource) => {
    const opening = !expandedResources().has(resource.id);
    setExpandedResources(prev => {
      const next = new Set(prev);
      if (opening) next.add(resource.id);
      else next.delete(resource.id);
      return next;
    });
    if (
      !opening ||
      loadedResources().has(resource.id) ||
      loadingResources().has(resource.id) ||
      !props.fetchResourceDetails
    )
      return;
    setLoadingResources(prev => new Set([...prev, resource.id]));
    props.fetchResourceDetails(resource).then(({ groups, error }) => {
      setDetailGroups(prev => {
        const next = new Map(prev);
        next.set(resource.id, groups);
        return next;
      });
      setDetailUnavailable(prev => {
        const next = new Set(prev);
        if (error && groups.length === 0) next.add(resource.id);
        else next.delete(resource.id);
        return next;
      });
      setLoadingResources(prev => {
        const next = new Set(prev);
        next.delete(resource.id);
        return next;
      });
      setLoadedResources(prev => new Set([...prev, resource.id]));
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
    setExpandedResources(new Set<string>());
    setLoadingResources(new Set<string>());
    setLoadedResources(new Set<string>());
    setDetailGroups(new Map<string, OpenShiftDetailGroup[]>());
    setDetailUnavailable(new Set<string>());
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
      toggleResource(item.resource);
      return false;
    };
  });

  createEffect(() => {
    const idx = props.detailCursorIndex();
    const item = flatItems()[idx];
    if (!props.detailFocused() || !item) {
      props.setDetailCursorAction(null);
      return;
    }
    if (loadingResources().has(item.resource.id)) props.setDetailCursorAction("loading");
    else props.setDetailCursorAction(expandedResources().has(item.resource.id) ? "collapse" : "expand");
  });

  const renderFallback = (text: string) => (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={t().foregroundMuted}>{text}</text>
    </box>
  );

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

            <For each={data()?.namespaces ?? []}>
              {ns => (
                <box flexDirection="column" width="100%">
                  <text fg={t().foregroundMuted} wrapMode="none">
                    {ns.namespace}
                  </text>
                  <For each={RESOURCE_GROUPS}>
                    {group => (
                      <For each={ns[group.key]}>
                        {(resource, resourceIdx) => {
                          const idx = () => resourceIndex(resource);
                          const isCursored = () => props.detailFocused() && props.detailCursorIndex() === idx();
                          const isExpanded = () => expandedResources().has(resource.id);
                          const isLoading = () => loadingResources().has(resource.id);
                          const groups = () => detailGroups().get(resource.id) ?? [];
                          const unavailable = () => detailUnavailable().has(resource.id);
                          const resourceTreePrefix = () => (resourceIdx() === ns[group.key].length - 1 ? "└─ " : "├─ ");
                          const childLead = () => (resourceIdx() === ns[group.key].length - 1 ? "   " : "│  ");
                          const color = () => statusColor(t(), statusCategory(resource.status));
                          const textColor = () => (isCursored() ? t().accent : t().foreground);

                          return (
                            <box flexDirection="column" width="100%">
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
                                  {resourceTreePrefix()}
                                </text>
                                <text
                                  flexShrink={0}
                                  wrapMode="none"
                                  fg={isCursored() ? t().accent : t().foregroundMuted}
                                >
                                  {isExpanded() ? "▾ " : "▸ "}
                                </text>
                                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={textColor()}>
                                  {resourceLabel(resource)}
                                </text>
                                <text flexShrink={0} width={2} wrapMode="none" fg={color()}>
                                  {statusMark(resource.status).padStart(2)}
                                </text>
                              </box>
                              <Show when={isExpanded()}>
                                <Show when={isLoading()}>
                                  <box flexDirection="row" width="100%">
                                    <text flexShrink={0} wrapMode="none" fg={t().border}>
                                      {childLead()}└─{" "}
                                    </text>
                                    <text fg={t().foregroundMuted}>Loading...</text>
                                  </box>
                                </Show>
                                <Show when={!isLoading() && unavailable()}>
                                  <box flexDirection="row" width="100%">
                                    <text flexShrink={0} wrapMode="none" fg={t().border}>
                                      {childLead()}└─{" "}
                                    </text>
                                    <text fg={t().foregroundMuted}>Unavailable</text>
                                  </box>
                                </Show>
                                <For each={groups()}>
                                  {(detailGroup, groupIdx) => {
                                    const groupIsLast = () => groupIdx() === groups().length - 1;
                                    const groupLead = () => childLead() + (groupIsLast() ? "└─ " : "├─ ");
                                    const lineLead = () => childLead() + (groupIsLast() ? "   " : "│  ");
                                    return (
                                      <box flexDirection="column" width="100%">
                                        <box flexDirection="row" width="100%">
                                          <text flexShrink={0} wrapMode="none" fg={t().border}>
                                            {groupLead()}
                                          </text>
                                          <text
                                            flexGrow={1}
                                            flexShrink={1}
                                            wrapMode="none"
                                            truncate
                                            fg={t().foregroundMuted}
                                          >
                                            {detailGroup.name}
                                          </text>
                                          <text
                                            flexShrink={0}
                                            width={2}
                                            wrapMode="none"
                                            fg={statusColor(t(), statusCategory(detailGroup.status))}
                                          >
                                            {statusMark(detailGroup.status).padStart(2)}
                                          </text>
                                        </box>
                                        <For each={detailGroup.lines}>
                                          {(line, lineIdx) => (
                                            <box flexDirection="row" width="100%">
                                              <text flexShrink={0} wrapMode="none" fg={t().border}>
                                                {lineLead()}
                                                {lineIdx() === detailGroup.lines.length - 1 ? "└─ " : "├─ "}
                                              </text>
                                              <text
                                                flexGrow={1}
                                                flexShrink={1}
                                                wrapMode="none"
                                                truncate
                                                fg={t().foregroundMuted}
                                              >
                                                {line.text}
                                              </text>
                                              <text
                                                flexShrink={0}
                                                width={2}
                                                wrapMode="none"
                                                fg={statusColor(t(), statusCategory(line.status))}
                                              >
                                                {statusMark(line.status).padStart(2)}
                                              </text>
                                            </box>
                                          )}
                                        </For>
                                      </box>
                                    );
                                  }}
                                </For>
                              </Show>
                            </box>
                          );
                        }}
                      </For>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </Show>
  );
}
