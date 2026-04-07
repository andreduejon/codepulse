import { homedir } from "node:os";
import { Show } from "solid-js";
import packageJson from "../../package.json";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";

interface CommandBarProps {
  commandBarMode: () => CommandBarMode;
  commandBarValue: () => string;
  searchInputValue: () => string;
  searchFocused: () => boolean;
  onInput: (val: string) => void;
  /** Whether detail panel is focused — switches border to muted. */
  detailFocused: () => boolean;
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

  const placeholder = () => {
    switch (props.commandBarMode()) {
      case "command":
        return "Enter command...";
      case "search":
        return "Search commits...";
      case "path":
        return "Enter path...";
      default:
        return "";
    }
  };

  const inputValue = () => {
    const mode = props.commandBarMode();
    return mode === "command" || mode === "path" ? props.commandBarValue() : props.searchInputValue();
  };

  const inputFocused = () => {
    const mode = props.commandBarMode();
    return props.searchFocused() || mode === "command" || mode === "path";
  };

  const modeBadgeLabel = () => {
    switch (props.commandBarMode()) {
      case "command":
        return " command ";
      case "search":
        return " search ";
      case "path":
        return " path ";
      default:
        return " idle ";
    }
  };

  const countColor = () => (state.searchQuery() && state.filteredRows().length === 0 ? t().error : t().foregroundMuted);

  const countText = () =>
    state.searchQuery()
      ? `${state.filteredRows().length} / ${state.graphRows().length}`
      : `${state.graphRows().length}`;

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
        <input
          focused={inputFocused()}
          flexGrow={1}
          placeholder={placeholder()}
          value={inputValue()}
          onInput={props.onInput}
          fg={t().foreground}
          placeholderColor={t().foregroundMuted}
          backgroundColor={t().background}
        />
        <text flexShrink={0} wrapMode="none" fg={countColor()}>
          {"  "}
          {countText()}
        </text>
      </box>

      <box height={1} />

      {/* Status row: error · git badge · mode badge · repo path · version */}
      <box flexDirection="row" width="100%">
        <Show when={state.error()}>
          <text flexShrink={0} wrapMode="none" fg={t().error}>
            {"error: "}
            {state.error()}
            {"  "}
          </text>
        </Show>
        {/* Git view badge */}
        <text flexShrink={0} wrapMode="none" fg={t().background} bg={t().accent}>
          {" git "}
        </text>
        <text flexShrink={0} wrapMode="none">
          {" "}
        </text>
        {/* Mode badge */}
        <text flexShrink={0} wrapMode="none" fg={t().accent} bg={t().backgroundElementActive}>
          {modeBadgeLabel()}
        </text>
        {/* Repo path + branch */}
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {"  "}
          {state.repoPath() ? state.repoPath().replace(homedir(), "~") : ""}
          {state.currentBranch() ? `:${state.currentBranch()}` : ""}
        </text>
        <Show when={state.viewingBranch()}>
          <text flexShrink={0} wrapMode="none" fg={t().accent}>
            {`  [viewing: ${state.viewingBranch()}]`}
          </text>
        </Show>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {`codepulse v${packageJson.version}`}
        </text>
      </box>
    </box>
  );
}
