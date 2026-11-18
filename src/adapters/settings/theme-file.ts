/** The custom themes file beside the settings file: read as text, for the app to parse (context/custom-themes.ts). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addDebugEvent } from "../../core/debug-events";
import { defaultConfigPath } from "./config";

export function defaultCustomThemesPath(): string {
  return join(dirname(defaultConfigPath()), "themes.json");
}

/** The file's text, or null when it doesn't exist or can't be read (named in Debug unless it's just missing). */
export function readCustomThemesFile(path = defaultCustomThemesPath()): { path: string; contents: string } | null {
  try {
    return { path, contents: readFileSync(path, "utf-8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      addDebugEvent({ source: "error", message: `${path}: could not read custom themes` });
    }
    return null;
  }
}
