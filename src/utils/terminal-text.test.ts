import { describe, expect, test } from "bun:test";
import { parseLogLines } from "../providers/github-actions/log-dialog";
import { cellWidth, sliceCells, stripTerminalControls, truncateCells } from "./terminal-text";

test.each([
  ["SGR colors", "\x1b[36;1mnpm test\x1b[0m", "npm test"],
  ["OSC title and clipboard writes", "a\x1b]0;PWNED\x07b\x1b]52;c;aGk=\x1b\\c", "abc"],
  ["unterminated OSC", "ok\x1b]8;;https://x", "ok"],
  ["terminal reset and charset escapes", "\x1bcA\x1b(BB", "AB"],
  ["bell, CR, and DEL; tabs kept", "x\x07\ty\r\x7f", "x\ty"],
])("stripTerminalControls removes %s", (_name, input, expected) => {
  expect(stripTerminalControls(input)).toBe(expected);
});

test("log lines are classified after removing color codes", () => {
  expect(parseLogLines("2024-01-01T00:00:00.0000000Z \x1b[31m##[error]boom\x1b[0m")).toEqual([
    { kind: "error", text: "boom", lineNo: 1 },
  ]);
});

describe("terminal cell helpers", () => {
  test("measure wide characters as two columns", () => {
    expect(cellWidth("abc")).toBe(3);
    expect(cellWidth("界界")).toBe(4);
  });
  test("slice and truncate by columns at whole characters", () => {
    expect(sliceCells("界界END", 2, 3)).toBe("界E");
    expect(sliceCells("界界END", 1, 3)).toBe("界");
    expect(truncateCells("界界界END", 5)).toBe("界界…");
    expect(truncateCells("short", 10)).toBe("short");
  });
});
