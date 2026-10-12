import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config";
import { addDebugEvent } from "../debug/events";
import { type CustomTheme, type Theme, themes } from "./theme";

type ColorKey = Exclude<keyof Theme, "name">;
const colorKeys = Object.keys(themes["catppuccin-mocha"]).filter(key => key !== "name") as ColorKey[];
// Unlike $, this end assertion also rejects a trailing newline.
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/;
const validHex = /^#[0-9a-fA-F]{6}(?![\s\S])/;

export function defaultCustomThemesPath(): string {
  return join(dirname(defaultConfigPath()), "themes.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTheme(id: string, value: unknown): CustomTheme {
  if (id.length > 64 || !validId.test(id)) throw new Error("invalid theme ID");
  if (Object.hasOwn(themes, id) || Object.hasOwn(Object.prototype, id) || id === "prototype") {
    throw new Error("reserved theme ID");
  }
  if (!isObject(value)) throw new Error("definition must be an object");
  if (Object.keys(value).some(key => key !== "name" && key !== "base" && key !== "colors")) {
    throw new Error("unknown definition field");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 64 || /\p{Cc}/u.test(value.name)) {
    throw new Error("invalid theme name");
  }
  let base: string | undefined;
  if (Object.hasOwn(value, "base")) {
    if (typeof value.base !== "string" || !Object.hasOwn(themes, value.base)) {
      throw new Error("base must be a predefined theme ID");
    }
    base = value.base;
  }
  if (!isObject(value.colors)) throw new Error("colors must be an object");
  const suppliedKeys = Object.keys(value.colors);
  if (suppliedKeys.some(key => !colorKeys.includes(key as ColorKey))) throw new Error("unknown color field");

  const theme = { name: value.name } as Theme;
  const baseTheme = base ? themes[base] : undefined;
  for (const key of colorKeys) {
    const supplied = Object.hasOwn(value.colors, key);
    if (!supplied && !base) throw new Error("standalone theme is missing colors");
    const color = supplied ? value.colors[key] : baseTheme?.[key];
    if (key === "graphColors") {
      if (
        !Array.isArray(color) ||
        color.length === 0 ||
        !color.every(entry => typeof entry === "string" && validHex.test(entry))
      ) {
        throw new Error("graphColors must be a nonempty array of #RRGGBB colors");
      }
      theme.graphColors = color.map(entry => entry.toLowerCase());
    } else {
      if (typeof color !== "string" || !validHex.test(color)) throw new Error("colors must use #RRGGBB");
      theme[key] = color.toLowerCase();
    }
  }
  return { id, theme, ...(base ? { base } : {}), overrides: base ? (suppliedKeys as ColorKey[]) : [] };
}

export function loadCustomThemes(path = defaultCustomThemesPath()): CustomTheme[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      addDebugEvent({ source: "error", message: `${path}: could not read custom themes` });
    }
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    addDebugEvent({ source: "error", message: `${path}: invalid themes JSON` });
    return [];
  }
  if (!isObject(parsed)) {
    addDebugEvent({ source: "error", message: `${path}: themes must be an object` });
    return [];
  }

  const customThemes: CustomTheme[] = [];
  for (const [id, value] of Object.entries(parsed)) {
    try {
      customThemes.push(parseTheme(id, value));
    } catch (error) {
      const label = id.length <= 64 && validId.test(id) ? ` theme "${id}"` : " theme entry";
      addDebugEvent({ source: "error", message: `${path}:${label}: ${(error as Error).message}` });
    }
  }
  return customThemes;
}
