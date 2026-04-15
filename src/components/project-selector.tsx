import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import packageJson from "../../package.json";
import { useT } from "../hooks/use-t";
import { KeyHint } from "./key-hint";
import LogoBanner, { LOGO_WIDTH } from "./logo-banner";

interface ProjectSelectorProps {
  /** Informational message to show (e.g. "Doesn't look like a git repo"). */
  message?: string;
  /** Path associated with the message — shown on a separate muted line. */
  messagePath?: string;
  /** List of known repo paths from the global config. */
  knownRepos: string[];
  /** Currently open repo path — shown as context and excluded from the list.
   *  When set, Esc goes back (calls onCancel) instead of quitting. */
  currentRepo?: string;
  /** Called when the user presses Esc to go back (in-app mode only). */
  onCancel?: () => void;
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
 * pick one or type a custom path. Selection destroys the renderer
 * and re-execs the process with the new path.
 */
export default function ProjectSelector(props: Readonly<ProjectSelectorProps>) {
  const t = useT();
  const renderer = useRenderer();

  /** Whether we're in in-app mode (have a current repo to go back to). */
  const inApp = () => !!props.currentRepo;

  /** Selectable repos — excludes current repo in in-app mode. */
  const repos = () => {
    const all = props.knownRepos;
    const current = props.currentRepo;
    if (!current) return all;
    return all.filter(r => r !== current);
  };
  const hasRepos = () => repos().length > 0;

  /** Total navigable items: repos + 1 for the inline path input. */
  const itemCount = () => repos().length + 1;
  /** The cursor index that represents the path input row. */
  const pathInputIndex = () => repos().length;

  const [cursor, setCursor] = createSignal(hasRepos() ? 0 : pathInputIndex());
  /** Whether the path input field has focus (cursor is on the input row). */
  const pathFocused = () => cursor() === pathInputIndex();
  const [pathInputValue, setPathInputValue] = createSignal("");

  /** Destroy the renderer and re-exec with the given path. */
  const selectRepo = (repoPath: string) => {
    renderer.destroy();
    reExecWith(repoPath);
  };

  /** Handle Esc — go back (in-app) or quit (startup). */
  const handleEscape = () => {
    if (props.onCancel) {
      props.onCancel();
    } else {
      renderer.destroy();
    }
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
          setCursor(0);
          setPathInputValue("");
        } else {
          handleEscape();
        }
        return;
      }
      if (e.name === "up") {
        if (hasRepos()) {
          e.preventDefault();
          setCursor(repos().length - 1);
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
        setCursor(c => Math.max(0, c - 1));
        break;
      case "down":
      case "j":
        e.preventDefault();
        setCursor(c => Math.min(itemCount() - 1, c + 1));
        break;
      case "return":
        e.preventDefault();
        if (repos().length > 0 && cursor() < repos().length) {
          selectRepo(repos()[cursor()]);
        }
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
          <box
            width={LOGO_WIDTH}
            flexDirection="column"
            backgroundColor={t().background}
            paddingX={1}
            paddingY={1}
            border={["left"]}
            borderStyle="single"
            borderColor={t().primary}
          >
            <box paddingX={4}>
              <text wrapMode="word">
                <strong>
                  <span fg={t().primary}>{props.message}</span>
                </strong>
              </text>
            </box>
            <Show when={props.messagePath}>
              {messagePath => (
                <box paddingX={4}>
                  <text wrapMode="none" truncate fg={t().foregroundMuted}>
                    {shortPath(messagePath())}
                  </text>
                </box>
              )}
            </Show>
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
          {/* Header */}
          <box paddingX={4}>
            <text wrapMode="none">
              <strong>
                <span fg={t().accent}>Where to?</span>
              </strong>
            </text>
          </box>

          {/* Current repo — shown muted, not selectable (in-app only) */}
          <Show when={props.currentRepo}>
            {currentRepo => (
              <box flexDirection="row" width="100%" paddingX={4}>
                <text wrapMode="none" truncate fg={t().foregroundMuted}>
                  {`${shortPath(currentRepo())} (current)`}
                </text>
              </box>
            )}
          </Show>

          {/* Selectable repo list */}
          <For each={repos()}>
            {(repo, i) => (
              <box
                flexDirection="row"
                width="100%"
                paddingX={4}
                backgroundColor={cursor() === i() ? t().backgroundElement : undefined}
              >
                <text wrapMode="none" truncate fg={cursor() === i() ? t().accent : t().foreground}>
                  {shortPath(repo)}
                </text>
              </box>
            )}
          </For>

          <Show when={!hasRepos() && !props.currentRepo}>
            <box paddingX={4}>
              <text wrapMode="none" fg={t().foregroundMuted}>
                Nothing here yet
              </text>
            </box>
          </Show>

          {/* Inline path input — last navigable item in the list */}
          <box paddingX={4} backgroundColor={pathFocused() ? t().backgroundElement : undefined}>
            <input
              focused={pathFocused()}
              flexGrow={1}
              placeholder="Enter repository path..."
              value={pathInputValue()}
              onInput={setPathInputValue}
              fg={pathFocused() ? t().accent : t().foreground}
              placeholderColor={t().foregroundMuted}
              backgroundColor={pathFocused() ? t().backgroundElement : t().background}
            />
          </box>

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
          <KeyHint key="enter" desc=" open  " />
          <Show when={inApp()}>
            <KeyHint key="esc" desc=" back  " />
          </Show>
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
function reExecWith(repoPath: string): void {
  // Resolve ~ to home directory
  const resolved = repoPath.startsWith("~") ? repoPath.replace("~", homedir()) : repoPath;

  // Use spawnSync with an array to avoid shell interpolation of the repo path.
  // execSync(string) passes through a shell and is vulnerable to injection via
  // special characters in the path (backticks, $(), etc.).
  spawnSync(process.argv[0], [process.argv[1], resolved], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(0);
}
