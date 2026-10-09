import { type BoxRenderable, MouseButton } from "@opentui/core";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { KnownRepoInfo } from "../config";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { providerColors } from "../providers/colors";
import { type ProviderView, providerDisplayName } from "../providers/provider";
import { commandBarPlaceholder, commitCountText, filterBadgeLabel } from "../utils/command-bar-utils";
import { groupMembersForRepo, repoDisplayName } from "../utils/group-repos";
import Badge from "./badge";

interface CommandBarProps {
  commandBarMode: () => CommandBarMode;
  commandBarValue: () => string;
  searchInputValue: () => string;
  searchFocused: () => boolean;
  onInput: (val: string) => void;
  mouseEnabled?: () => boolean;
  onSelectMode?: (mode: "normal" | "search" | "path" | "ancestry") => void;
  onSelectProject?: (path: string) => void;
  /** Whether detail panel is focused — switches border to muted. */
  detailFocused: () => boolean;
  knownRepos: KnownRepoInfo[];
  currentRepo: string;
  currentGroup?: string;
  currentAppName?: string;
}

/** Provider, project and mode rows, with an inline input for colon commands. */
export default function CommandBar(props: Readonly<CommandBarProps>) {
  const { state, actions } = useAppState();
  const t = useT();
  const [hoveredProvider, setHoveredProvider] = createSignal<ProviderView | null>(null);
  const [hoveredMode, setHoveredMode] = createSignal<string | null>(null);
  const [hoveredProject, setHoveredProject] = createSignal<string | null>(null);
  const [contentWidth, setContentWidth] = createSignal(0);
  const enabledProviders = createMemo(() => {
    state.providers.getVersion();
    return state.providers.getEnabledViews();
  });

  const countColor = () => {
    const hSet = state.highlightSet();
    if (hSet && hSet.size === 0) return t().error;
    return t().foregroundMuted;
  };

  const countText = () => `${commitCountText(state.highlightSet(), state.graphRows().length)} commits`;

  const borderColor = () => (props.detailFocused() ? t().border : t().accent);
  const checkedOutBranch = () => state.currentBranch();
  const viewingBranch = () => state.viewingBranch();
  const viewingOtherBranch = () => !!viewingBranch() && viewingBranch() !== checkedOutBranch();
  const branchColorIndex = (name: string | null | undefined) => {
    if (!name) return null;
    return state.graphRows().find(row => row.branchName === name)?.nodeColor ?? null;
  };
  const groupMembers = createMemo(() =>
    groupMembersForRepo(props.knownRepos, props.currentRepo, {
      group: props.currentGroup,
      appName: props.currentAppName,
    }),
  );
  const projectBadges = createMemo(() => {
    const members = groupMembers();
    if (members.length > 0) return members;
    return [{ path: props.currentRepo, group: props.currentGroup, appName: props.currentAppName }];
  });
  const visibleProjects = createMemo(() => {
    const members = projectBadges();
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
  const wide = createMemo(() => {
    const providersWidth = enabledProviders().reduce((width, view) => width + providerDisplayName(view).length + 3, -1);
    const modesWidth =
      22 + filterBadgeLabel("search", state.searchQuery()).length + filterBadgeLabel("path", state.pathFilter()).length;
    return contentWidth() >= Math.max(120, providersWidth + modesWidth + 4);
  });

  return (
    <box
      width="100%"
      minHeight={wide() ? 5 : 7}
      flexShrink={0}
      backgroundColor={t().background}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      border={["left"]}
      borderStyle="single"
      borderColor={borderColor()}
    >
      <Show when={props.commandBarMode() !== "idle"}>
        <box height={1} flexShrink={0} flexDirection="row">
          <Show when={props.commandBarMode() === "command"}>
            <text flexShrink={0} wrapMode="none" fg={t().accent}>
              {":"}
            </text>
          </Show>
          <input
            focused
            flexGrow={1}
            placeholder={commandBarPlaceholder(props.commandBarMode())}
            value={props.commandBarMode() === "search" ? props.searchInputValue() : props.commandBarValue()}
            onInput={props.onInput}
            textColor={t().foreground}
            focusedTextColor={t().foreground}
            placeholderColor={t().foregroundMuted}
            cursorColor={t().accent}
            backgroundColor={t().background}
            focusedBackgroundColor={t().background}
          />
        </box>
        <box height={1} flexShrink={0} />
      </Show>

      {/* Measure this panel, not terminal width; keep controls mounted across resizes. */}
      <box
        width="100%"
        height={wide() ? 3 : 5}
        flexShrink={0}
        onSizeChange={function (this: BoxRenderable) {
          setContentWidth(this.width);
        }}
      >
        <box position="absolute" top={0} left={0} flexDirection="row" flexShrink={0}>
          <box flexDirection="row" gap={1} flexShrink={0}>
            <For each={enabledProviders()}>
              {view => {
                const selected = () => state.activeProviderView() === view;
                const hovered = () => hoveredProvider() === view && props.mouseEnabled?.() !== false;
                const colors = () => providerColors(t(), view);
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: TUI provider selection also supports Tab keyboard cycling.
                  // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected provider already uses normal badge colors.
                  <text
                    flexShrink={0}
                    wrapMode="none"
                    fg={selected() ? colors().bg : hovered() ? t().foreground : t().foregroundMuted}
                    bg={t().backgroundElementActive}
                    onMouseOver={() => setHoveredProvider(view)}
                    onMouseOut={() => setHoveredProvider(null)}
                    onMouseDown={event => {
                      if (event.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                      event.preventDefault();
                      actions.setActiveProviderView(view);
                    }}
                  >
                    {` ${providerDisplayName(view)} `}
                  </text>
                );
              }}
            </For>
          </box>
        </box>
        <box
          position="absolute"
          top={wide() ? 2 : 4}
          left={0}
          flexDirection="row"
          width={wide() ? "45%" : "100%"}
          minWidth={0}
          flexShrink={0}
        >
          <box flexDirection="row" flexShrink={1} minWidth={0} overflow="hidden">
            <Show when={projectBadges().length > 0}>
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
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI projects also support Shift+Left/Right. */}
                    {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected project already uses accent badge colors. */}
                    <box
                      flexShrink={0}
                      onMouseOver={() => setHoveredProject(repo.path)}
                      onMouseOut={() => setHoveredProject(null)}
                      onMouseDown={event => {
                        if (event.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                        event.preventDefault();
                        if (repo.path !== props.currentRepo) props.onSelectProject?.(repo.path);
                      }}
                    >
                      <Show
                        when={repo.path === props.currentRepo}
                        fallback={
                          <text
                            flexShrink={0}
                            wrapMode="none"
                            fg={
                              hoveredProject() === repo.path && props.mouseEnabled?.() !== false
                                ? t().foreground
                                : t().foregroundMuted
                            }
                            bg={t().backgroundElementActive}
                          >
                            {` ${repoDisplayName(repo)} `}
                          </text>
                        }
                      >
                        <Badge name={repoDisplayName(repo)} color={t().accent} noShrink />
                      </Show>
                    </box>
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
          </box>
        </box>
        <box
          position="absolute"
          top={wide() ? 0 : 2}
          left={wide() ? "auto" : 0}
          right={wide() ? 0 : "auto"}
          flexDirection="row"
          width="auto"
          minWidth={0}
          flexShrink={0}
        >
          <box flexDirection="row" gap={1} flexShrink={0}>
            <For each={["normal", "search", "path", "ancestry"] as const}>
              {mode => {
                const selected = () => {
                  const inputMode = props.commandBarMode();
                  const activeMode =
                    inputMode === "search" || inputMode === "path" ? inputMode : (state.highlightMode() ?? "normal");
                  return activeMode === mode;
                };
                const hovered = () => hoveredMode() === mode && props.mouseEnabled?.() !== false;
                const label = () => {
                  if (mode === "search") return filterBadgeLabel("search", state.searchQuery());
                  if (mode === "path") return filterBadgeLabel("path", state.pathFilter());
                  return mode === "normal" ? " normal " : " ancestry ";
                };
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: TUI modes also have keyboard shortcuts.
                  // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected modes use the same highlight colors.
                  <text
                    flexShrink={0}
                    wrapMode="none"
                    fg={selected() ? t().accent : hovered() ? t().foreground : t().foregroundMuted}
                    bg={t().backgroundElementActive}
                    onMouseOver={() => setHoveredMode(mode)}
                    onMouseOut={() => setHoveredMode(null)}
                    onMouseDown={event => {
                      if (event.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                      event.preventDefault();
                      props.onSelectMode?.(mode);
                    }}
                  >
                    {label()}
                  </text>
                );
              }}
            </For>
          </box>
        </box>
        <box
          position="absolute"
          top={wide() ? 2 : 4}
          right={0}
          flexDirection="row"
          gap={1}
          flexShrink={1}
          minWidth={0}
          overflow="hidden"
          maxWidth="45%"
        >
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
              <box flexDirection="row">
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
              </box>
            </Show>
          </Show>
          <text flexShrink={0} wrapMode="none" fg={countColor()} bg={t().backgroundElementActive}>
            {` ${countText()} `}
          </text>
        </box>
      </box>
    </box>
  );
}
