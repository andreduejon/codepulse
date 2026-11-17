import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { themes } from "../../src/tui/context/theme";
import { colorLines } from "./colors";

const theme = themes["catppuccin-mocha"];
const span = (text: string, fg: string, bg: string = theme.background) => ({
  text,
  fg: RGBA.fromHex(fg),
  bg: RGBA.fromHex(bg),
  attributes: 0,
  width: text.length,
});

test("each color is named by its theme key; the default text and the screen's background stay plain", () => {
  const frame = {
    cols: 60,
    rows: 2,
    cursor: [0, 0] as [number, number],
    lines: [
      {
        spans: [
          span("scan · ", theme.foreground),
          span("1 critical", theme.severityCritical),
          span(" · ", theme.foreground),
          span("0 medium", theme.foregroundMuted),
          span(" ?", theme.warning),
          span(" ".repeat(40), theme.foreground),
        ],
      },
      { spans: [span(" Snyk ", theme.snykFg, theme.snykBg), span(" ", theme.foreground), span("x", "#123456")] },
    ],
  };
  expect(colorLines(frame, theme)).toEqual([
    // One color can be several keys: each is named, a graph lane only when nothing else has its color.
    "scan · «error|severityCritical|diffRemoved:1 critical» · «foregroundMuted:0 medium»«warning|severityMedium: ?»",
    "«background|githubActionsFg|jenkinsFg|+3/snykBg: Snyk » «#123456:x»",
  ]);
});

test("spaces show only their background, and neighbors with the same colors are one mark", () => {
  const frame = {
    cols: 20,
    rows: 1,
    cursor: [0, 0] as [number, number],
    lines: [
      {
        spans: [
          span("  ", theme.accent),
          span("ab", theme.accent, theme.backgroundElement),
          span("cd", theme.accent, theme.backgroundElement),
          span("  ", theme.foreground, theme.backgroundElement),
          span(" ".repeat(10), theme.foreground),
        ],
      },
    ],
  };
  expect(colorLines(frame, theme)).toEqual(["  «gitBg|accent/backgroundElement:abcd»«/backgroundElement:  »"]);
});
