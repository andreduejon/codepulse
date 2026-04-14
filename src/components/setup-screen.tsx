import { homedir } from "node:os";
import { useKeyboard } from "@opentui/solid";
import packageJson from "../../package.json";
import { useT } from "../hooks/use-t";
import { KeyHint } from "./key-hint";
import LogoBanner, { LOGO_WIDTH } from "./logo-banner";

interface SetupScreenProps {
  repoPath: string;
  /** Called when the user dismisses the welcome screen (Enter). */
  onComplete: () => void;
  /** Called when the user presses q to quit. */
  onQuit: () => void;
}

/**
 * First-launch welcome screen shown when a git repo has no entry
 * in the global config yet.
 *
 * Shows the logo, a brief welcome message, and key command hints.
 * Enter dismisses the screen and proceeds to the graph.
 */
export default function SetupScreen(props: Readonly<SetupScreenProps>) {
  const t = useT();

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "return") {
      e.preventDefault();
      props.onComplete();
    }
    if (e.name === "q") {
      e.preventDefault();
      props.onQuit();
    }
  });

  /** Max chars available for the path display (card width - borders - padding). */
  const MAX_PATH_CHARS = LOGO_WIDTH - 2 - 8;

  const displayPath = () => {
    const short = props.repoPath.replace(homedir(), "~");
    if (short.length <= MAX_PATH_CHARS) return short;
    return `...${short.slice(-(MAX_PATH_CHARS - 3))}`;
  };

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={t().backgroundPanel}>
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <LogoBanner />

        <box height={2} />

        {/* Welcome card */}
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
          <box paddingX={4}>
            <text wrapMode="word">
              <strong>
                <span fg={t().accent}>Welcome to your git graph visualizer!</span>
              </strong>
            </text>
          </box>
          <box paddingX={4}>
            <text wrapMode="none" fg={t().foregroundMuted}>
              {displayPath()}
            </text>
          </box>
          <box height={1} />
          <box paddingX={4}>
            <text wrapMode="none">
              <strong>
                <span fg={t().accent}>Handy keys to remember</span>
              </strong>
            </text>
          </box>
          <box paddingX={4} flexDirection="row">
            <text wrapMode="none" fg={t().foregroundMuted}>
              {"?  see what you can do"}
            </text>
          </box>
          <box paddingX={4} flexDirection="row">
            <text wrapMode="none" fg={t().foregroundMuted}>
              {"m  tweak your setup"}
            </text>
          </box>

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
          <KeyHint key="enter" desc=" continue  " />
          <KeyHint key="q" desc=" quit" />
        </box>
      </box>
    </box>
  );
}
