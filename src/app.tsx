import { AppContent } from "./app-content";
import type { AppProps } from "./app-types";
import ErrorScreen from "./components/error-screen";
import ProjectSelector from "./components/project-selector";
import { createThemeState } from "./context/theme";

export default function App(props: Readonly<AppProps>) {
  const themeState = createThemeState(props.themeName);

  const mode = props.startupMode;

  if (mode.kind === "error") {
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <ErrorScreen error={mode.message} />
      </themeState.ThemeContext.Provider>
    );
  }

  if (mode.kind === "selector") {
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <ProjectSelector message={mode.message} messagePath={mode.messagePath} knownRepos={mode.knownRepos} />
      </themeState.ThemeContext.Provider>
    );
  }

  return <AppContent {...props} themeState={themeState} />;
}
