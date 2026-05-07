import { createMemo, For, Show } from "solid-js";
import type { KnownRepoInfo } from "../config";
import Badge from "./badge";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { providerDisplayName } from "../providers/provider";
import { groupMembersForRepo, repoDisplayName } from "../utils/group-repos";
import {
  commandBarInputValue,
  commandBarPlaceholder,
  commitCountText,
  modeBadgeLabel,
} from "../utils/command-bar-utils";

interface CommandBarProps {
  commandBarMode: () => CommandBarMode;
  commandBarValue: () => string;
  searchInputValue: () => string;
  searchFocused: () => boolean;
  onInput: (val: string) => void;
  /** Whether detail panel is focused — switches border to muted. */
  detailFocused: () => boolean;
  knownRepos: KnownRepoInfo[];
  currentRepo: string;
  currentGroup?: string;
  currentAppName?: string;
}

/**
 * Command bar section: the always-visible input area below the graph.
 *
 * Renders:
 *  - A single `<input>` widget shared across all modes (idle / command / search / path)
 *  - Commit count display (filtered / total)
 *  - Status row: git badge · mode badge · branch badges
 */
export default function CommandBar(props: Readonly<CommandBarProps>) {
  const { state } = useAppState();
  const t = useT();

  const placeholder = () => commandBarPlaceholder(props.commandBarMode());

  const inputValue = () =>
    commandBarInputValue({
      commandBarMode: props.commandBarMode(),
      commandBarValue: props.commandBarValue(),
      searchInputValue: props.searchInputValue(),
      highlightMode: state.highlightMode(),
      pathFilter: state.pathFilter(),
    });

  const inputFocused = () => {
    const mode = props.commandBarMode();
    return props.searchFocused() || mode === "command" || mode === "path";
  };
  const promptPrefix = () => {
    const mode = props.commandBarMode();
    if (mode === "command") return ":";
    if (mode === "search") return "/";
    return "";
  };

  const modeBadge = () => modeBadgeLabel(props.commandBarMode(), state.highlightMode());

  const countColor = () => {
    const hSet = state.highlightSet();
    if (hSet && hSet.size === 0) return t().error;
    return t().foregroundMuted;
  };

  const countText = () => commitCountText(state.highlightSet(), state.graphRows().length);

  const borderColor = () => (props.detailFocused() ? t().border : t().accent);
  const checkedOutBranch = () => state.currentBranch();
  const viewingBranch = () => state.viewingBranch();
  const viewingOtherBranch = () => !!viewingBranch() && viewingBranch() !== checkedOutBranch();
  const branchColorIndex = (name: string | null | undefined) => {
    if (!name) return null;
    return state.graphRows().find(row => row.branchName === name)?.nodeColor ?? null;
  };
  const groupMembers = createMemo(() =>
    groupMembersForRepo(props.knownRepos, props.currentRepo, { group: props.currentGroup, appName: props.currentAppName }),
  );
  const visibleProjects = createMemo(() => {
    const members = groupMembers();
    if (members.length <= 3) return { leftHidden: 0, repos: members, rightHidden: 0 };

    const currentIdx = Math.max(
      0,
      members.findIndex(repo => repo.path === props.currentRepo),
    );
    const start = Math.min(Math.max(currentIdx - 1, 0), members.length - 3);
    return {
      leftHidden: start,
      repos: members.slice(start, start + 3),
      rightHidden: members.length - start - 3,
    };
  });

  return (
    <box
      width="100%"
      minHeight={5}
      backgroundColor={t().background}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      border={["left"]}
      borderStyle="single"
      borderColor={borderColor()}
    >
      {/* Input row */}
      <box flexGrow={1} flexDirection="row">
        <Show when={promptPrefix()}>
          <text flexShrink={0} wrapMode="none" fg={t().accent}>
            {promptPrefix()}
          </text>
        </Show>
        <input
          focused={inputFocused()}
          flexGrow={1}
          placeholder={placeholder()}
          value={inputValue()}
          onInput={props.onInput}
          textColor={t().foreground}
          focusedTextColor={t().foreground}
          placeholderColor={t().foregroundMuted}
          cursorColor={t().accent}
          backgroundColor={t().background}
          focusedBackgroundColor={t().background}
        />
        <text flexShrink={0} wrapMode="none" fg={countColor()}>
          {"  "}
          {countText()}
        </text>
      </box>

      <box height={1} />

      {/* Status row: git badge · mode badge · project badges · branch badges */}
      <box flexDirection="row" width="100%">
        {/* Provider view badge */}
        {(() => {
          const view = state.activeProviderView();
          if (view === "git") {
            return (
              <text flexShrink={0} wrapMode="none" fg={t().background} bg={t().accent}>
                {" Git "}
              </text>
            );
          }
          const label = providerDisplayName(view);
          const bg = view === "jenkins" ? t().jenkinsBg : t().githubActionsBg;
          const fg = view === "jenkins" ? t().jenkinsFg : t().githubActionsFg;
          return (
            <text flexShrink={0} wrapMode="none" fg={fg} bg={bg}>
              {` ${label} `}
            </text>
          );
        })()}
        <text flexShrink={0} wrapMode="none">
          {" "}
        </text>
        {/* Mode badge */}
        <text flexShrink={0} wrapMode="none" fg={t().accent} bg={t().backgroundElementActive}>
          {modeBadge()}
        </text>
        <Show when={groupMembers().length > 1}>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" · "}
          </text>
          <Show when={visibleProjects().leftHidden > 0}>
            <Badge name={`◂${visibleProjects().leftHidden}`} dimmed noShrink />
            <text flexShrink={0} wrapMode="none">
              {" "}
            </text>
          </Show>
          <For each={visibleProjects().repos}>
            {(repo, idx) => (
              <>
                <Show when={idx() > 0}>
                  <text flexShrink={0} wrapMode="none">
                    {" "}
                  </text>
                </Show>
                <Badge
                  name={repoDisplayName(repo)}
                  color={repo.path === props.currentRepo ? t().accent : undefined}
                  dimmed={repo.path !== props.currentRepo}
                  noShrink
                />
              </>
            )}
          </For>
          <Show when={visibleProjects().rightHidden > 0}>
            <text flexShrink={0} wrapMode="none">
              {" "}
            </text>
            <Badge name={`${visibleProjects().rightHidden}▸`} dimmed noShrink />
          </Show>
        </Show>
        <box flexGrow={1} />
        <Show when={checkedOutBranch() || viewingBranch()}>
          <Show
            when={viewingOtherBranch()}
            fallback={
              <Badge
                name={checkedOutBranch()}
                colorIndex={branchColorIndex(checkedOutBranch()) ?? undefined}
                color={branchColorIndex(checkedOutBranch()) === null ? t().accent : undefined}
                noShrink
              />
            }
          >
            <>
              <Badge
                name={viewingBranch() ?? ""}
                colorIndex={branchColorIndex(viewingBranch()) ?? undefined}
                color={branchColorIndex(viewingBranch()) === null ? t().accent : undefined}
                noShrink
              />
              <text flexShrink={0} wrapMode="none">
                {" "}
              </text>
              <Badge name={checkedOutBranch()} dimmed noShrink />
            </>
          </Show>
        </Show>
      </box>
    </box>
  );
}
