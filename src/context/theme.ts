import { type Accessor, createContext, createSignal, useContext } from "solid-js";
import { addDebugEvent } from "../debug/events";
import {
  ayuDark,
  catppuccinMocha,
  dracula,
  gruvbox,
  monokai,
  nord,
  oliveGarden,
  oneDark,
  openCodeOriginal,
  rosePine,
  synthwave,
  tokyoNight,
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
  gitBg: string;
  accent: string;
  info: string;
  error: string;
  warning: string;
  success: string;
  severityCritical: string;
  severityHigh: string;
  severityMedium: string;
  severityLow: string;
  graphColors: string[];
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  githubActionsFg: string;
  githubActionsBg: string;
  jenkinsFg: string;
  jenkinsBg: string;
  snykFg: string;
  snykBg: string;
  openShiftFg: string;
  openShiftBg: string;
}

export interface CustomTheme {
  id: string;
  theme: Theme;
  base?: string;
  overrides: Exclude<keyof Theme, "name">[];
}

export const themes: Record<string, Theme> = {
  "open-code-original": openCodeOriginal,
  "catppuccin-mocha": catppuccinMocha,
  "tokyo-night": tokyoNight,
  dracula: dracula,
  nord: nord,
  "one-dark": oneDark,
  gruvbox: gruvbox,
  monokai: monokai,
  "ayu-mirage": ayuDark,
  synthwave: synthwave,
  "rose-pine": rosePine,
  "olive-garden": oliveGarden,
};

export const themeNames = Object.keys(themes);

const ThemeContext = createContext<{
  theme: Accessor<Theme>;
  setTheme: (name: string) => void;
  themeName: Accessor<string>;
  themes: Record<string, Theme>;
  customThemes: readonly CustomTheme[];
}>();

export function createThemeState(initialTheme: string = "catppuccin-mocha", customThemes: readonly CustomTheme[] = []) {
  const registry = { ...themes, ...Object.fromEntries(customThemes.map(custom => [custom.id, custom.theme])) };
  const initialName = Object.hasOwn(registry, initialTheme) ? initialTheme : "catppuccin-mocha";
  if (initialName !== initialTheme) {
    addDebugEvent({
      source: "error",
      message: `Theme ${JSON.stringify(initialTheme)} unavailable; using Catppuccin Mocha`,
    });
  }
  const [themeName, setThemeName] = createSignal(initialName);
  const theme = () => registry[themeName()];

  return {
    theme,
    setTheme: (name: string) => {
      if (Object.hasOwn(registry, name)) setThemeName(name);
    },
    themeName,
    themes: registry,
    customThemes,
    ThemeContext,
  };
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export { ThemeContext };
