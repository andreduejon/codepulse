import { createContext, useContext, createSignal, type Accessor } from "solid-js";
import {
  openCodeOriginal,
  catppuccinMocha,
  tokyoNight,
  dracula,
  nord,
  oneDark,
  gruvbox,
  monokai,
  ayuDark,
  synthwave,
  rosePine,
} from "./theme-definitions";

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
  graphColors: string[];
  diffAdded: string;
  diffRemoved: string;
}

export const themes: Record<string, Theme> = {
  "open-code-original": openCodeOriginal,
  "catppuccin-mocha": catppuccinMocha,
  "tokyo-night": tokyoNight,
  "dracula": dracula,
  "nord": nord,
  "one-dark": oneDark,
  "gruvbox": gruvbox,
  "monokai": monokai,
  "ayu-mirage": ayuDark,
  "synthwave": synthwave,
  "rose-pine": rosePine,
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