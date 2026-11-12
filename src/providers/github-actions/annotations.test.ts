import { expect, test } from "bun:test";
import { annotationNotes } from "./annotations";

test("annotation notes: failures and warnings with their place, the first line of the message", () => {
  expect(
    annotationNotes([
      { level: "failure", path: "src/auth.test.ts", line: 42, message: "Expected 200, received 401\n  at line 42" },
      { level: "notice", path: "src/a.ts", line: 1, message: "FYI" },
      { level: "warning", path: ".github", line: null, message: "Node 16 actions are deprecated" },
      { level: "failure", path: "src/b.ts", line: null, message: "Type error" },
    ]),
  ).toEqual([
    {
      id: "0",
      mark: "fail",
      text: "src/auth.test.ts:42  Expected 200, received 401",
      search: "Expected 200, received 401",
    },
    // The workflow itself (.github) has no file worth naming.
    { id: "2", mark: "warning", text: "Node 16 actions are deprecated", search: "Node 16 actions are deprecated" },
    { id: "3", mark: "fail", text: "src/b.ts  Type error", search: "Type error" },
  ]);
});
