import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import packageJson from "../../package.json";
import { type KnownRepoInfo, removeRepoConfig } from "../config";
import { useT } from "../hooks/use-t";
import type { KeyboardScope } from "../keyboard/scope";
import { buildProjectSelectorRows, isRepoRow, isSelectableProjectSelectorRow } from "../utils/project-selector-rows";
import { scrollElementIntoView } from "../utils/scroll";
import { KeyHint, KeyHintSeparator } from "./key-hint";
import LogoBanner, { LOGO_WIDTH } from "./logo-banner";
import MessageBox from "./message-box";

const DETAIL_COL_WIDTH = 32;
const clipLeft = (value: string, width: number) => (value.length <= width ? value : `…${value.slice(-(width - 1))}`);

interface ProjectSelectorProps {
  /** Informational message to show (e.g. "Doesn't look like a git repo"). */
  message?: string;
  /** Path associated with the message — shown on a separate muted line. */
  messagePath?: string;
  /** List of known repo paths from the global config. */
  knownRepos: KnownRepoInfo[];
  /** Currently open repo path — shown as context and excluded from the list.
   *  When set, Esc goes back (calls onCancel) instead of quitting. */
  currentRepo?: string;
  /** Called when the user presses Esc to go back (in-app mode only). */
  onCancel?: () => void;
  /** Called for in-app repo selection. Startup mode falls back to process re-exec. */
  onSelectRepo?: (repoPath: string) => void;
  /** Optional keyboard scope hook for in-app usage only. */
  setKeyboardScopeOverride?: (scope: KeyboardScope | null) => void;
}

/**
 * Project selector screen — used in two contexts:
 *
 * 1. **Startup** (no currentRepo): shown when codepulse is started from a
 *    non-git directory. Esc quits the app.
 * 2. **In-app** (currentRepo set): shown when "Switch repository" is selected
 *    from the menu. Esc goes back to the graph.
 *
 * Shows previously-used repos from the config file. The user can
 * pick one or type a custom path. Startup selection re-execs; in-app
 * selection can be handled by the parent without leaving the renderer.
 */
export default function ProjectSelector(props: Readonly<ProjectSelectorProps>) {
  const t = useT();
  const renderer = useRenderer();

  /** Whether we're in in-app mode (have a current repo to go back to). */
  const inApp = () => !!props.currentRepo;
  const [savedRepos, setSavedRepos] = createSignal(props.knownRepos);

  const repos = () => savedRepos();
  const rows = createMemo(() => buildProjectSelectorRows(repos(), props.currentRepo));
  const selectableIndexes = createMemo(() =>
    rows().flatMap((row, idx) => (isSelectableProjectSelectorRow(row) ? [idx] : [])),
  );
  const hasRepos = () => repos().length > 0;
  const firstSelectableIndex = () => selectableIndexes()[0] ?? 0;
  const [cursor, setCursor] = createSignal(firstSelectableIndex());
  /** Whether the path input field has focus (cursor is on the input row). */
  const selectedRow = () => rows()[cursor()];
  const pathFocused = () => selectedRow()?.kind === "path-input";
  const [pathInputValue, setPathInputValue] = createSignal("");
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const rowRefs: Array<Renderable | undefined> = [];
  const escapeHint = () => {
    if (pathFocused() && hasRepos()) return " list  ";
    if (inApp()) return " back  ";
    return " quit  ";
  };

  createEffect(() => {
    props.setKeyboardScopeOverride?.("repo-selector");
  });

  createEffect(() => {
    const selectable = selectableIndexes();
    setCursor(c => (selectable.includes(c) ? c : (selectable[0] ?? 0)));
  });

  createEffect(() => {
    const row = rowRefs[cursor()];
    if (scrollboxRef && row) scrollElementIntoView(scrollboxRef, row);
  });

  onCleanup(() => props.setKeyboardScopeOverride?.(null));

  /** Destroy the renderer and re-exec with the given path. */
  const selectRepo = (repoPath: string) => {
    const canonical = canonicalRepoPath(repoPath);
    if (props.onSelectRepo) {
      props.onSelectRepo(canonical);
      return;
    }
    renderer.destroy();
    reExecWith(canonical);
  };

  /** Handle Esc — go back (in-app) or quit (startup). */
  const handleEscape = () => {
    if (props.onCancel) {
      props.onCancel();
    } else {
      renderer.destroy();
    }
  };

  const forgetSelectedRepo = () => {
    const row = selectedRow();
    if (!row || row.kind !== "repo" || row.current) return;
    if (!removeRepoConfig(row.repo.path)) return;
    setSavedRepos(prev => prev.filter(repo => repo.path !== row.repo.path));
  };

  const moveCursor = (delta: 1 | -1) => {
    const selectable = selectableIndexes();
    const pos = selectable.indexOf(cursor());
    const nextPos = Math.max(0, Math.min(selectable.length - 1, pos + delta));
    setCursor(selectable[nextPos] ?? cursor());
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;

    // q quits from any context except when typing in path input
    if (e.name === "q" && !pathFocused()) {
      e.preventDefault();
      renderer.destroy();
      return;
    }

    // Path input focused — only arrow keys navigate out, letters go to input
    if (pathFocused()) {
      if (e.name === "escape") {
        e.preventDefault();
        if (hasRepos()) {
          setCursor(firstSelectableIndex());
          setPathInputValue("");
        } else {
          handleEscape();
        }
        return;
      }
      if (e.name === "up") {
        if (hasRepos()) {
          e.preventDefault();
          moveCursor(-1);
        }
        return;
      }
      if (e.name === "return") {
        e.preventDefault();
        const value = pathInputValue().trim();
        if (value) {
          const expanded = value.startsWith("~") ? value.replace("~", homedir()) : value;
          selectRepo(resolve(expanded));
        }
        return;
      }
      // Let the input widget handle all other keys (including j, k, etc.)
      return;
    }

    // List mode
    switch (e.name) {
      case "up":
      case "k":
        e.preventDefault();
        moveCursor(-1);
        break;
      case "down":
      case "j":
        e.preventDefault();
        moveCursor(1);
        break;
      case "return": {
        e.preventDefault();
        const row = selectedRow();
        if (row?.kind === "repo" && !row.current) {
          selectRepo(row.repo.path);
        } else if (row?.kind === "path-input") {
          const value = pathInputValue().trim();
          if (value) {
            const expanded = value.startsWith("~") ? value.replace("~", homedir()) : value;
            selectRepo(resolve(expanded));
          }
        }
        break;
      }
      case "f":
        e.preventDefault();
        forgetSelectedRepo();
        break;
      case "escape":
        e.preventDefault();
        handleEscape();
        break;
    }
  });

  const shortPath = (p: string) => p.replace(homedir(), "~");

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={t().backgroundPanel}>
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <LogoBanner />

        <box height={2} />

        {/* Informational message — separate section with primary border */}
        <Show when={props.message}>
          <box width={LOGO_WIDTH}>
            <MessageBox
              kind="info"
              message={props.message ?? ""}
              detail={props.messagePath ? shortPath(props.messagePath) : undefined}
            />
          </box>

          <box height={1} />
        </Show>

        {/* Main selector card */}
        <box
          width={LOGO_WIDTH}
          flexDirection="column"
          backgroundColor={t().background}
          paddingX={1}
          paddingY={1}
          border={["left"]}
          borderStyle="single"
          borderColor={t().accent}
        >
          <scrollbox
            ref={scrollboxRef}
            height={Math.min(16, rows().length)}
            scrollY
            scrollX={false}
            verticalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column">
              <For each={rows()}>
                {(row, idx) => (
                  <box
                    ref={(el: Renderable) => {
                      rowRefs[idx()] = el;
                    }}
                    flexDirection="row"
                    width="100%"
                    paddingX={4}
                    backgroundColor={
                      cursor() === idx() && isSelectableProjectSelectorRow(row) ? t().backgroundElement : undefined
                    }
                  >
                    <Show
                      when={isRepoRow(row) ? row : undefined}
                      fallback={
                        <Show
                          when={row.kind === "path-input"}
                          fallback={
                            <text wrapMode="none" truncate fg={t().foregroundMuted}>
                              {row.kind === "group" ? <strong>{row.label}</strong> : ""}
                            </text>
                          }
                        >
                          <input
                            focused={pathFocused()}
                            flexGrow={1}
                            placeholder="Enter custom path..."
                            value={pathInputValue()}
                            onInput={setPathInputValue}
                            textColor={t().foreground}
                            focusedTextColor={t().foreground}
                            placeholderColor={t().foregroundMuted}
                            cursorColor={t().accent}
                            backgroundColor={t().background}
                            focusedBackgroundColor={t().backgroundElement}
                          />
                        </Show>
                      }
                    >
                      {repoRow => (
                        <>
                          <text
                            wrapMode="none"
                            truncate
                            fg={
                              cursor() === idx() ? t().accent : repoRow().current ? t().foregroundMuted : t().foreground
                            }
                          >
                            {repoRow().current ? `${repoRow().label} (current)` : repoRow().label}
                          </text>
                          <Show when={repoRow().detail}>
                            {detail => (
                              <>
                                <box flexGrow={1} />
                                <text flexShrink={0} width={DETAIL_COL_WIDTH} wrapMode="none" fg={t().foregroundMuted}>
                                  {clipLeft(detail(), DETAIL_COL_WIDTH).padStart(DETAIL_COL_WIDTH)}
                                </text>
                              </>
                            )}
                          </Show>
                        </>
                      )}
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>

          <Show when={!hasRepos() && !props.currentRepo}>
            <box paddingX={4}>
              <text wrapMode="none" fg={t().foregroundMuted}>
                Nothing here yet
              </text>
            </box>
          </Show>

          <box height={1} />

          {/* Version — bottom-right within card */}
          <box flexDirection="row" paddingX={4}>
            <box flexGrow={1} />
            <text wrapMode="none" fg={t().foregroundMuted}>
              {`v${packageJson.version}`}
            </text>
          </box>
        </box>

        <box height={1} />

        {/* Footer hints */}
        <box flexDirection="row" width={LOGO_WIDTH} height={1}>
          <box flexGrow={1} />
          <KeyHint key="enter" desc=" open" />
          <KeyHintSeparator />
          <Show when={!pathFocused() && hasRepos()}>
            <KeyHint key="f" desc=" forget" />
          </Show>
          <Show when={!pathFocused() && hasRepos()}>
            <KeyHintSeparator />
          </Show>
          <KeyHint key="esc" desc={escapeHint()} />
          <KeyHintSeparator />
          <KeyHint key="q" desc=" quit" />
        </box>
      </box>
    </box>
  );
}

/**
 * Re-exec codepulse with the given repository path.
 * Replaces the current process — does not return.
 *
 * Uses spawnSync with an array of arguments (not a shell string) to prevent
 * shell interpretation of special characters in the repo path.
 *
 * NOTE: the caller must call `renderer.destroy()` first to cleanly
 * restore the terminal before spawning the child process.
 */
function canonicalRepoPath(repoPath: string): string {
  // Resolve ~ to home directory
  const resolved = repoPath.startsWith("~") ? repoPath.replace("~", homedir()) : repoPath;
  const rootResult = spawnSync("git", ["-C", resolved, "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return rootResult.status === 0 && rootResult.stdout.trim() ? rootResult.stdout.trim() : resolved;
}

function reExecWith(repoPath: string): void {
  // Use spawnSync with an array to avoid shell interpolation of the repo path.
  // execSync(string) passes through a shell and is vulnerable to injection via
  // special characters in the path (backticks, $(), etc.).
  spawnSync(process.argv[0], [process.argv[1], repoPath], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(0);
}
