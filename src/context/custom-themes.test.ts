import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config";
import { clearDebugEvents, getDebugEvents } from "../debug/events";
import { defaultCustomThemesPath, loadCustomThemes } from "./custom-themes";
import { createThemeState, themes } from "./theme";

let root: string;
let path: string;
beforeEach(() => {
  const approvedTemp = join(tmpdir(), "opencode");
  root = mkdtempSync(join(existsSync(approvedTemp) ? approvedTemp : tmpdir(), "codepulse-themes-"));
  path = join(root, "themes.json");
  clearDebugEvents();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearDebugEvents();
});

function writeThemes(value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

test("themes live beside the existing global config", () => {
  expect(defaultCustomThemesPath()).toBe(join(dirname(defaultConfigPath()), "themes.json"));
});

test("derived themes inherit colors, normalize overrides, and copy graph colors", () => {
  const before = structuredClone(themes);
  writeThemes({ "my-night": { name: "My Night", base: "catppuccin-mocha", colors: { primary: "#ABCDEF" } } });
  const [custom] = loadCustomThemes(path);
  expect(custom).toEqual({
    id: "my-night",
    base: "catppuccin-mocha",
    overrides: ["primary"],
    theme: { ...themes["catppuccin-mocha"], name: "My Night", primary: "#abcdef" },
  });
  expect(custom.theme.graphColors).not.toBe(themes["catppuccin-mocha"].graphColors);
  custom.theme.graphColors.push("#123456");
  expect(themes).toEqual(before);
  expect(getDebugEvents()).toEqual([]);
});

test("standalone themes require and normalize all colors without an override list", () => {
  const { name: _name, ...colors } = themes.dracula;
  writeThemes({ "full-theme": { name: "A Full Theme", colors: { ...colors, foreground: "#AABBCC" } } });
  const [custom] = loadCustomThemes(path);
  expect(custom).toEqual({
    id: "full-theme",
    theme: { ...themes.dracula, name: "A Full Theme", foreground: "#aabbcc" },
    overrides: [],
  });
  expect(custom.theme.graphColors).not.toBe(themes.dracula.graphColors);
});

test("graph overrides replace the complete array and inherited-only themes are valid", () => {
  writeThemes({
    "one-line": { name: "One Line", base: "dracula", colors: { graphColors: ["#ABCDEF"] } },
    "inherited-only": { name: "Inherited", base: "nord", colors: {} },
  });
  const [custom, inherited] = loadCustomThemes(path);
  expect(custom.theme.graphColors).toEqual(["#abcdef"]);
  expect(custom.overrides).toEqual(["graphColors"]);
  expect(inherited.overrides).toEqual([]);
  expect(inherited.theme).toEqual({ ...themes.nord, name: "Inherited" });
  expect(inherited.theme.graphColors).not.toBe(themes.nord.graphColors);
});

test("builtin IDs and prototype IDs cannot replace themes, and bases must be own builtin IDs", () => {
  const definition = { name: "Custom", base: "nord", colors: {} };
  const before = structuredClone(themes);
  const entries = Object.fromEntries(
    ["nord", "constructor", "prototype", "__proto__", "toString"].map(id => [id, definition]),
  );
  writeThemes({
    ...entries,
    "valid-theme": definition,
    "custom-chain": { ...definition, base: "valid-theme" },
    "missing-base": { ...definition, base: "missing" },
    "constructor-base": { ...definition, base: "constructor" },
    "prototype-base": { ...definition, base: "__proto__" },
    "null-base": { ...definition, base: null },
  });
  expect(loadCustomThemes(path).map(custom => custom.id)).toEqual(["valid-theme"]);
  expect(getDebugEvents()).toHaveLength(10);
  expect(themes).toEqual(before);
  expect(Object.hasOwn(themes, "valid-theme")).toBe(false);
});

test("invalid entries are isolated and diagnostics never echo rejected field values", () => {
  const valid = { name: "Valid", base: "nord", colors: { primary: "#123456" } };
  const invalid = {
    "bad-hex": { ...valid, colors: { primary: "secret-token-value" } },
    "short-hex": { ...valid, colors: { primary: "#abc" } },
    "long-hex": { ...valid, colors: { primary: "#12345678" } },
    "non-hex": { ...valid, colors: { primary: "#gggggg" } },
    "number-color": { ...valid, colors: { primary: 123456 } },
    "spaced-hex": { ...valid, colors: { primary: " #abcdef" } },
    "newline-hex": { ...valid, colors: { primary: "#abcdef\n" } },
    "empty-graph": { ...valid, colors: { graphColors: [] } },
    "bad-graph": { ...valid, colors: { graphColors: ["#123456", "secret-array-value"] } },
    "newline-graph": { ...valid, colors: { graphColors: ["#123456\n"] } },
    "scalar-graph": { ...valid, colors: { graphColors: "#123456" } },
    "unknown-color": { ...valid, colors: { "secret-color-key": "secret-color-value" } },
    "color-name": { ...valid, colors: { name: "secret-name" } },
    "unknown-field": { ...valid, "secret-definition-key": "secret-definition-value" },
    incomplete: { name: "Incomplete", colors: { primary: "#abcdef" } },
    "missing-colors": { name: "Missing", base: "nord" },
    "null-colors": { ...valid, colors: null },
    "array-colors": { ...valid, colors: [] },
    "bad-name": { ...valid, name: "secret\ncontrol" },
    "empty-name": { ...valid, name: " " },
    "long-name": { ...valid, name: "x".repeat(65) },
    "missing-name": { base: "nord", colors: {} },
    "null-entry": null,
    "array-entry": [],
    "Bad-ID": valid,
    "bad--id": valid,
    "-bad-id": valid,
    "bad-id-": valid,
    "bad-id\n": valid,
    ["x".repeat(65)]: valid,
    "secret\ninvalid-id": valid,
  };
  writeThemes({ before: valid, ...invalid, after: valid });
  expect(loadCustomThemes(path).map(custom => custom.id)).toEqual(["before", "after"]);
  const events = getDebugEvents();
  expect(events).toHaveLength(Object.keys(invalid).length);
  for (const event of events) {
    expect(event.source).toBe("error");
    expect(event.message).toContain(path);
    expect(event.message).not.toContain("secret");
    expect(event.message).not.toContain("\n");
  }
  expect(events.some(event => event.message.includes('theme "bad-hex"'))).toBe(true);
});

test("printable Unicode names and 64-character names and IDs are accepted", () => {
  const id = "x".repeat(64);
  writeThemes({
    [id]: { name: "x".repeat(64), base: "nord", colors: {} },
    "unicode-name": { name: "Café 🌙", base: "nord", colors: {} },
  });
  expect(loadCustomThemes(path).map(custom => custom.id)).toEqual([id, "unicode-name"]);
  expect(getDebugEvents()).toEqual([]);
});

test("malformed JSON and non-object roots fail safely without exposing their contents", () => {
  writeFileSync(path, '{"secret-file-content": invalid JSON}');
  expect(loadCustomThemes(path)).toEqual([]);
  expect(getDebugEvents()).toHaveLength(1);
  expect(getDebugEvents()[0].message).not.toContain("secret-file-content");
  for (const value of [null, [], "secret-root-value", 42, true]) {
    clearDebugEvents();
    writeThemes(value);
    expect(loadCustomThemes(path)).toEqual([]);
    expect(getDebugEvents()).toHaveLength(1);
    expect(getDebugEvents()[0].message).toContain(path);
    expect(getDebugEvents()[0].message).not.toContain("secret");
  }
});

test("missing files are silent, other read errors are reported, and loading never writes", () => {
  expect(loadCustomThemes(path)).toEqual([]);
  expect(getDebugEvents()).toEqual([]);
  expect(existsSync(path)).toBe(false);
  expect(loadCustomThemes(root)).toEqual([]);
  expect(getDebugEvents()).toHaveLength(1);
  expect(getDebugEvents()[0].message).toContain(root);
  clearDebugEvents();
  writeThemes({ "valid-theme": { name: "Valid", base: "nord", colors: {} } });
  const contents = readFileSync(path, "utf-8");
  expect(loadCustomThemes(path)).toHaveLength(1);
  expect(readFileSync(path, "utf-8")).toBe(contents);
});

test("registry resolves custom startup IDs and falls back for missing IDs without changing builtins", () => {
  const before = structuredClone(themes);
  writeThemes({ "my-night": { name: "My Night", base: "nord", colors: { primary: "#ABCDEF" } } });
  const customThemes = loadCustomThemes(path);
  const state = createThemeState("my-night", customThemes);
  expect(state.themeName()).toBe("my-night");
  expect(state.theme()).toBe(customThemes[0].theme);
  expect(state.themes.nord).toBe(themes.nord);
  expect(getDebugEvents()).toEqual([]);
  state.setTheme("nord");
  expect(state.themeName()).toBe("nord");
  expect(state.theme()).toBe(themes.nord);
  state.setTheme("constructor");
  expect(state.themeName()).toBe("nord");
  for (const missing of ["removed-theme", "constructor", "__proto__"]) {
    clearDebugEvents();
    const fallback = createThemeState(missing, customThemes);
    expect(fallback.themeName()).toBe("catppuccin-mocha");
    expect(fallback.theme()).toBe(themes["catppuccin-mocha"]);
    expect(getDebugEvents()).toHaveLength(1);
    expect(getDebugEvents()[0].source).toBe("error");
  }
  expect(themes).toEqual(before);
  expect(Object.hasOwn(themes, "my-night")).toBe(false);
});
