import { homedir } from "node:os";
import { Show } from "solid-js";
import packageJson from "../../package.json";
import type { KnownRepoInfo } from "../config";
import GroupStrip from "./group-strip";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { providerDisplayName } from "../providers/provider";
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
 *  - Status row: git badge · mode badge · repo path · version
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

      {/* Status row: git badge · mode badge · repo path · version */}
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
        {/* Repo path + branch */}
        <text flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
          {"  "}
          {state.repoPath() ? state.repoPath().replace(homedir(), "~") : ""}
          {state.currentBranch() ? `:${state.currentBranch()}` : ""}
        </text>
        <Show when={state.viewingBranch()}>
          <text flexShrink={1} wrapMode="none" truncate fg={t().accent}>
            {`  [viewing: ${state.viewingBranch()}]`}
          </text>
        </Show>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {`v${packageJson.version}`}
        </text>
      </box>
      <GroupStrip
        repos={props.knownRepos}
        currentRepo={props.currentRepo}
        currentGroup={props.currentGroup}
        currentAppName={props.currentAppName}
      />
    </box>
  );
}
