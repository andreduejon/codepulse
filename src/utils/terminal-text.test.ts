import { expect, test } from "bun:test";
import { parseLogLines } from "../providers/github-actions/log-dialog";
import { stripTerminalControls } from "./terminal-text";

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
