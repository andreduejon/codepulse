/**
 * GitHub's Pull requests tab: the open pull requests whose branch points at the commit (the graph's `PR #123` chips),
 * one row each with its title, its branch and the one it would merge into, and its author. `o` opens it on GitHub.
 * Only a commit that has one has the tab (as Stashes), so it never shows empty.
 *
 * Receives props directly (not via useContext): it may render during setup, before the AppStateContext.Provider
 * mounts (AGENTS.md rule 5).
 */

import { createEffect, createMemo, For } from "solid-js";
import type { GitHubPullRequest } from "../../../core/github/types";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatRelativeDate } from "../../utils/date";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "../shared/detail-rows";
import { useDetailTree } from "../shared/detail-tree";
import { type RowShortcut, useOpenRowShortcut } from "../shared/open-row";

export interface PullRequestsTabProps {
  sha: string;
  pullRequestsAt: (sha: string) => GitHubPullRequest[];
  /** Read the commit again (`Reload commit`): its runs and the open pull requests. */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /** Why it cannot load; null when it can. */
  unavailableReason?: string | null;
  /** The provider is fetching. */
  loading?: boolean;
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
}

const RELOAD = "reload";
const rowKey = (pr: GitHubPullRequest) => `pull:${pr.number}`;

export function PullRequestsTab(props: Readonly<PullRequestsTabProps>) {
  const t = useT();
  const pulls = () => props.pullRequestsAt(props.sha);
  const reloadEnabled = () => !props.unavailableReason;
  const keys = createMemo(() => [...(reloadEnabled() ? [RELOAD] : []), ...pulls().map(rowKey)]);
  const indexOf = (key: string) => keys().indexOf(key);
  const cursored = (key: string) => props.detailFocused() && props.detailCursorIndex() === indexOf(key);
  const current = () => pulls().find(pr => rowKey(pr) === keys()[props.detailCursorIndex()]);

  const activate = () => {
    if (keys()[props.detailCursorIndex()] === RELOAD && reloadEnabled() && !props.loading)
      void props.fetchCommitData?.(props.sha, true);
    return false;
  };
  const mouse = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate,
    inert: key => key === RELOAD && (!reloadEnabled() || !!props.loading),
  });
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
    url: () => current()?.url ?? null,
    setDetailCursorShortcut: props.setDetailCursorShortcut,
  });
  createEffect(() => {
    const onReload = props.detailFocused() && keys()[props.detailCursorIndex()] === RELOAD;
    props.setDetailCursorAction(onReload && reloadEnabled() && !props.loading ? "reload" : null);
  });

  const renderPull = (pr: GitHubPullRequest, index: () => number) => {
    const key = rowKey(pr);
    const last = () => index() === pulls().length - 1;
    // A draft is not ready for review: muted, as its chip in the graph.
    const fg = () => (cursored(key) ? t().accent : pr.draft ? t().foregroundMuted : t().foreground);
    return (
      <box
        {...mouse.mouseRow(key, () => indexOf(key))}
        ref={tree.ref(key)}
        flexDirection="row"
        width="100%"
        backgroundColor={cursored(key) ? t().backgroundElementActive : mouse.hoverBg(key)}
      >
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
          {last() ? "└─ " : "├─ "}
        </text>
        <ScrollingLabel
          selectable={!props.mouseEnabled}
          text={`PR #${pr.number} ${pr.title}`}
          tail={[
            ` · ${pr.headRef} → ${pr.baseRef}`,
            pr.author ? ` · @${pr.author}` : "",
            pr.draft ? " · draft" : "",
          ].join("")}
          tailFg={t().foregroundMuted}
          active={cursored(key)}
          fg={fg()}
          grow={false}
        />
        <box flexGrow={1} />
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {pr.updatedAt ? `  ${formatRelativeDate(pr.updatedAt)}` : ""}
        </text>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%">
      <ProviderActionRow
        label="Reload commit"
        status={props.loading ? BUSY.fetchingRuns : ""}
        disabled={!reloadEnabled()}
        cursored={cursored(RELOAD)}
        mouseEnabled={props.mouseEnabled}
        rows={mouse}
        rowKey={RELOAD}
        index={() => indexOf(RELOAD)}
        rowRef={tree.ref(RELOAD)}
      />
      <ProviderSummaryRow label="total pull requests" count={pulls().length} />
      <For each={pulls()}>{renderPull}</For>
    </box>
  );
}
