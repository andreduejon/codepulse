import { For, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { Commit, GraphRow } from "../git/types";
import { useT } from "../hooks/use-t";
import Badge from "./badge";
import { BADGE_PADDING } from "./detail-types";

/** Branch and Tags sections of the Info tab: ref badges in the commit's lane colour, with upstream tracking. */
export function DetailRefs(
  props: Readonly<{
    commit: Commit;
    row: GraphRow;
    /** Usable panel width; badges clip to it. */
    panelWidth: number;
    getTagForHash: (hash: string) => string | null;
  }>,
) {
  const { state } = useAppState();
  const t = useT();

  // Split refs into branches (branch/remote/head) and tags
  const branchRefs = () => props.commit.refs.filter(r => r.type !== "tag");
  const tagRefs = () => props.commit.refs.filter(r => r.type === "tag");

  // The node color index for this commit's lane
  const nodeColorIndex = () => props.row.nodeColor ?? 0;

  // For non-tip commits: find the remote counterpart of branchName
  const remoteName = () => {
    const bn = props.row.branchName;
    if (!bn) return null;
    const remote = state.branches().find(b => b.isRemote && b.name.endsWith(`/${bn}`));
    return remote?.name ?? null;
  };

  /**
   * Look up upstream tracking info for a local branch name.
   * Returns null when the branch has no upstream configured.
   */
  const branchTracking = (name: string) => {
    const b = state.branches().find(br => !br.isRemote && br.name === name);
    if (!b?.upstream) return null;
    return { upstream: b.upstream, ahead: b.ahead ?? 0, behind: b.behind ?? 0 };
  };

  return (
    <>
      {/* ── Branch ── */}
      <text fg={t().accent} wrapMode="none">
        <strong>Branch</strong>
      </text>
      <box flexDirection="column">
        <Show
          when={branchRefs().length > 0}
          fallback={
            <Show
              when={props.row.branchName !== ""}
              fallback={(() => {
                const tag = props.getTagForHash(props.commit.hash);
                return tag ? (
                  <Badge name={tag} colorIndex={nodeColorIndex()} visibleWidth={props.panelWidth - BADGE_PADDING} />
                ) : (
                  <Badge name="deleted" colorIndex={0} dimmed />
                );
              })()}
            >
              {/* Graph-inferred branch: local badge, optional remote badge, right-aligned tracking */}
              <box flexDirection="row" width="100%">
                <Badge
                  name={props.row.branchName}
                  colorIndex={nodeColorIndex()}
                  visibleWidth={props.panelWidth - BADGE_PADDING}
                />
                {(() => {
                  const tr = branchTracking(props.row.branchName);
                  if (!tr) {
                    // No tracking — show remote badge if present
                    const rn = remoteName();
                    return rn ? (
                      <Badge name={rn} colorIndex={nodeColorIndex()} visibleWidth={props.panelWidth - BADGE_PADDING} />
                    ) : null;
                  }
                  return (
                    <>
                      <box flexGrow={1} />
                      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                        {`↑${tr.ahead} ↓${tr.behind}`}
                      </text>
                    </>
                  );
                })()}
              </box>
            </Show>
          }
        >
          {/* Sort: locals first, remotes after */}
          <For
            each={[...branchRefs().filter(r => r.type !== "remote"), ...branchRefs().filter(r => r.type === "remote")]}
          >
            {ref => {
              const tr = ref.type === "branch" ? branchTracking(ref.name) : null;
              return (
                <box flexDirection="row" width="100%">
                  <Badge
                    name={ref.name}
                    colorIndex={nodeColorIndex()}
                    dimmed={ref.type === "stash" || ref.type === "uncommitted"}
                    visibleWidth={props.panelWidth - BADGE_PADDING}
                  />
                  {tr ? (
                    <>
                      <box flexGrow={1} />
                      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                        {`↑${tr.ahead} ↓${tr.behind}`}
                      </text>
                    </>
                  ) : null}
                </box>
              );
            }}
          </For>
        </Show>
      </box>
      <box height={1} />

      {/* ── Tags ── */}
      <Show when={tagRefs().length > 0}>
        <text fg={t().accent} wrapMode="none">
          <strong>Tags</strong>
        </text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={tagRefs()}>
            {ref => (
              <Badge name={ref.name} colorIndex={nodeColorIndex()} visibleWidth={props.panelWidth - BADGE_PADDING} />
            )}
          </For>
        </box>
        <box height={1} />
      </Show>
    </>
  );
}
