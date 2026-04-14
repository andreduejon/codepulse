import { useKeyboard, useRenderer } from "@opentui/solid";
import { For } from "solid-js";
import packageJson from "../../package.json";
import { useT } from "../hooks/use-t";
import { KeyHint } from "./key-hint";
import LogoBanner, { LOGO_WIDTH } from "./logo-banner";

interface ErrorScreenProps {
  error: string;
}

/**
 * Full-screen error display with the codepulse logo.
 *
 * Used for fatal startup errors (e.g. "Git is not installed") and
 * the "terminal too small" runtime fallback.
 *
 * q exits the application. No other keys are handled.
 */
export default function ErrorScreen(props: Readonly<ErrorScreenProps>) {
  const t = useT();
  const renderer = useRenderer();

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "q") {
      renderer.destroy();
    }
  });

  const errorLines = () => props.error.split("\n");

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={t().backgroundPanel}>
      {/* Centered content area */}
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <LogoBanner />

        {/* Spacer */}
        <box height={2} />

        {/* Error section — width matches logo */}
        <box
          width={LOGO_WIDTH}
          flexDirection="column"
          backgroundColor={t().background}
          paddingX={1}
          paddingY={1}
          border={["left"]}
          borderStyle="single"
          borderColor={t().error}
        >
          <For each={errorLines()}>
            {(line: string, i: () => number) => (
              <box paddingX={4}>
                {i() === 0 ? (
                  <text wrapMode="word">
                    <strong>
                      <span fg={t().error}>{line}</span>
                    </strong>
                  </text>
                ) : (
                  <text wrapMode="word" fg={t().foregroundMuted}>
                    {line}
                  </text>
                )}
              </box>
            )}
          </For>

          <box height={1} />

          {/* Version — bottom-right within card */}
          <box flexDirection="row" paddingX={4}>
            <box flexGrow={1} />
            <text wrapMode="none" fg={t().foregroundMuted}>
              {`v${packageJson.version}`}
            </text>
          </box>
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Footer hint */}
        <box flexDirection="row" width={LOGO_WIDTH} height={1}>
          <box flexGrow={1} />
          <KeyHint key="q" desc=" quit" />
        </box>
      </box>
    </box>
  );
}
