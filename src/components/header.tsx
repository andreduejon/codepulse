import { Show, For } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";

export default function Header() {
  const { state } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor={t().backgroundPanel}
      paddingX={1}
      border={["bottom"]}
      borderColor={t().border}
      borderStyle="single"
    >
      {/* App name */}
      <text flexShrink={0} wrapMode="none">
        <span fg={t().primary}>gittree</span>
      </text>

      {/* Repo name */}
      <Show when={state.repoName()}>
        <text flexShrink={0} wrapMode="none">
          <span fg={t().foregroundMuted}> ~ </span>
          <span fg={t().foreground}>{state.repoName()}</span>
        </text>
      </Show>

      {/* Current branch */}
      <Show when={state.currentBranch()}>
        <text flexShrink={0} wrapMode="none">
          <span fg={t().foregroundMuted}> on </span>
          <span fg={t().success}>{state.currentBranch()}</span>
        </text>
      </Show>

      {/* Branch indicator */}
      <Show when={state.showAllBranches()}>
        <text flexShrink={0} wrapMode="none">
          <span fg={t().foregroundMuted}> (all branches)</span>
        </text>
      </Show>

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Commit count */}
      <text flexShrink={0} wrapMode="none">
        <span fg={t().foregroundMuted}>
          {state.filteredRows().length} commits
        </span>
      </text>

      {/* Search indicator */}
      <Show when={state.searchQuery()}>
        <text flexShrink={0} wrapMode="none">
          <span fg={t().foregroundMuted}> | </span>
          <span fg={t().warning}>search: </span>
          <span fg={t().foreground}>{state.searchQuery()}</span>
        </text>
      </Show>
    </box>
  );
}
