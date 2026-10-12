import { useTerminalDimensions } from "@opentui/solid";
import { Show } from "solid-js";
import { AppContent } from "./app-content";
import type { AppProps } from "./app-types";
import ErrorScreen from "./components/error-screen";
import ProjectSelector from "./components/project-selector";
import { MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { createThemeState } from "./context/theme";

export default function App(props: Readonly<AppProps>) {
  const themeState = createThemeState(props.themeName);

  const mode = props.startupMode;

  if (mode.kind === "error" || mode.kind === "selector") {
    const dimensions = useTerminalDimensions();
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <Show
          when={dimensions().width >= MIN_TERMINAL_WIDTH && dimensions().height >= MIN_TERMINAL_HEIGHT}
          fallback={
            <ErrorScreen
              error={`Terminal too small (${dimensions().width}\u00d7${dimensions().height})\nResize to at least ${MIN_TERMINAL_WIDTH} columns and ${MIN_TERMINAL_HEIGHT} rows.`}
            />
          }
        >
          {mode.kind === "error" ? (
            <ErrorScreen error={mode.message} />
          ) : (
            <ProjectSelector message={mode.message} messagePath={mode.messagePath} knownRepos={mode.knownRepos} />
          )}
        </Show>
      </themeState.ThemeContext.Provider>
    );
  }

  return <AppContent {...props} themeState={themeState} />;
}
