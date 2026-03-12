import { createContext, useContext, createSignal, type Accessor } from "solid-js";

export interface Theme {
  name: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  foreground: string;
  foregroundMuted: string;
  border: string;
  borderActive: string;
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  // Graph colors
  graphColors: string[];
  // Diff colors
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
}

const catppuccinMocha: Theme = {
  name: "Catppuccin Mocha",
  background: "#1e1e2e",
  backgroundPanel: "#181825",
  backgroundElement: "#313244",
  foreground: "#cdd6f4",
  foregroundMuted: "#6c7086",
  border: "#45475a",
  borderActive: "#89b4fa",
  primary: "#89b4fa",
  secondary: "#cba6f7",
  accent: "#f5c2e7",
  error: "#f38ba8",
  warning: "#f9e2af",
  success: "#a6e3a1",
  info: "#89dceb",
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
  diffAddedBg: "#1a3a2a",
  diffRemovedBg: "#3a1a1a",
};

const tokyoNight: Theme = {
  name: "Tokyo Night",
  background: "#1a1b26",
  backgroundPanel: "#16161e",
  backgroundElement: "#292e42",
  foreground: "#c0caf5",
  foregroundMuted: "#565f89",
  border: "#3b4261",
  borderActive: "#7aa2f7",
  primary: "#7aa2f7",
  secondary: "#bb9af7",
  accent: "#f7768e",
  error: "#f7768e",
  warning: "#e0af68",
  success: "#9ece6a",
  info: "#7dcfff",
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
  diffAddedBg: "#1a2a1a",
  diffRemovedBg: "#2a1a1a",
};

const dracula: Theme = {
  name: "Dracula",
  background: "#282a36",
  backgroundPanel: "#21222c",
  backgroundElement: "#44475a",
  foreground: "#f8f8f2",
  foregroundMuted: "#6272a4",
  border: "#44475a",
  borderActive: "#bd93f9",
  primary: "#bd93f9",
  secondary: "#ff79c6",
  accent: "#8be9fd",
  error: "#ff5555",
  warning: "#f1fa8c",
  success: "#50fa7b",
  info: "#8be9fd",
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
  diffAddedBg: "#1a3a2a",
  diffRemovedBg: "#3a1a1a",
};

const nord: Theme = {
  name: "Nord",
  background: "#2e3440",
  backgroundPanel: "#272c36",
  backgroundElement: "#3b4252",
  foreground: "#d8dee9",
  foregroundMuted: "#616e88",
  border: "#3b4252",
  borderActive: "#88c0d0",
  primary: "#88c0d0",
  secondary: "#b48ead",
  accent: "#81a1c1",
  error: "#bf616a",
  warning: "#ebcb8b",
  success: "#a3be8c",
  info: "#5e81ac",
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
  diffAddedBg: "#2a3a2a",
  diffRemovedBg: "#3a2a2a",
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
