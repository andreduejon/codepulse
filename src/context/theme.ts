import { createContext, useContext, createSignal, type Accessor } from "solid-js";

export interface Theme {
  name: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  backgroundElementActive: string;
  foreground: string;
  foregroundMuted: string;
  border: string;
  primary: string;
  accent: string;
  error: string;
  success: string;
  // Graph colors
  graphColors: string[];
  // Diff colors
  diffAdded: string;
  diffRemoved: string;
}

const catppuccinMocha: Theme = {
  name: "Catppuccin Mocha",
  background: "#1e1e2e",
  backgroundPanel: "#181825",
  backgroundElement: "#313244",
  backgroundElementActive: "#45475a",
  foreground: "#cdd6f4",
  foregroundMuted: "#6c7086",
  border: "#45475a",
  primary: "#89b4fa",
  accent: "#f5c2e7",
  error: "#f38ba8",
  success: "#a6e3a1",
  graphColors: [
    "#f38ba8",
    "#a6e3a1",
    "#89b4fa",
    "#f9e2af",
    "#cba6f7",
    "#94e2d5",
    "#fab387",
    "#74c7ec",
    "#f2cdcd",
    "#89dceb",
    "#b4befe",
    "#eba0ac",
  ],
  diffAdded: "#a6e3a1",
  diffRemoved: "#f38ba8",
};

const tokyoNight: Theme = {
  name: "Tokyo Night",
  background: "#1a1b26",
  backgroundPanel: "#16161e",
  backgroundElement: "#292e42",
  backgroundElementActive: "#3b4261",
  foreground: "#c0caf5",
  foregroundMuted: "#565f89",
  border: "#3b4261",
  primary: "#7aa2f7",
  accent: "#f7768e",
  error: "#f7768e",
  success: "#9ece6a",
  graphColors: [
    "#f7768e",
    "#9ece6a",
    "#7aa2f7",
    "#e0af68",
    "#bb9af7",
    "#73daca",
    "#ff9e64",
    "#7dcfff",
    "#c0caf5",
    "#2ac3de",
    "#b4f9f8",
    "#ff007c",
  ],
  diffAdded: "#9ece6a",
  diffRemoved: "#f7768e",
};

const dracula: Theme = {
  name: "Dracula",
  background: "#282a36",
  backgroundPanel: "#21222c",
  backgroundElement: "#44475a",
  backgroundElementActive: "#565972",
  foreground: "#f8f8f2",
  foregroundMuted: "#6272a4",
  border: "#44475a",
  primary: "#bd93f9",
  accent: "#8be9fd",
  error: "#ff5555",
  success: "#50fa7b",
  graphColors: [
    "#ff5555",
    "#50fa7b",
    "#bd93f9",
    "#f1fa8c",
    "#ff79c6",
    "#8be9fd",
    "#ffb86c",
    "#6272a4",
    "#f8f8f2",
    "#ff6e6e",
    "#69ff94",
    "#d6acff",
  ],
  diffAdded: "#50fa7b",
  diffRemoved: "#ff5555",
};

const nord: Theme = {
  name: "Nord",
  background: "#2e3440",
  backgroundPanel: "#272c36",
  backgroundElement: "#3b4252",
  backgroundElementActive: "#434c5e",
  foreground: "#d8dee9",
  foregroundMuted: "#616e88",
  border: "#3b4252",
  primary: "#88c0d0",
  accent: "#81a1c1",
  error: "#bf616a",
  success: "#a3be8c",
  graphColors: [
    "#bf616a",
    "#a3be8c",
    "#81a1c1",
    "#ebcb8b",
    "#b48ead",
    "#88c0d0",
    "#d08770",
    "#5e81ac",
    "#d8dee9",
    "#8fbcbb",
    "#a3be8c",
    "#bf616a",
  ],
  diffAdded: "#a3be8c",
  diffRemoved: "#bf616a",
};

export const themes: Record<string, Theme> = {
  "catppuccin-mocha": catppuccinMocha,
  "tokyo-night": tokyoNight,
  dracula: dracula,
  nord: nord,
};

export const themeNames = Object.keys(themes);

const ThemeContext = createContext<{
  theme: Accessor<Theme>;
  setTheme: (name: string) => void;
  themeName: Accessor<string>;
}>();

export function createThemeState(initialTheme: string = "catppuccin-mocha") {
  const [themeName, setThemeName] = createSignal(initialTheme);
  const theme = () => themes[themeName()] ?? catppuccinMocha;

  return {
    theme,
    setTheme: (name: string) => {
      if (themes[name]) setThemeName(name);
    },
    themeName,
    ThemeContext,
  };
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export { ThemeContext };
