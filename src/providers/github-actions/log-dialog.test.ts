import { expect, test } from "bun:test";
import { parseLogLines } from "./log-dialog";

const kinds = (raw: string) => parseLogLines(raw).map(line => line.kind);

test("a test failure is an error line: a line ending in FAILED, and an error or exception class with its message", () => {
  expect(kinds("PaymentServiceTest > refundsTwice() FAILED")).toEqual(["error"]);
  expect(kinds("> Task :test FAILED")).toEqual(["error"]);
  expect(kinds("    org.opentest4j.AssertionFailedError: expected: <200> but was: <401>")).toEqual(["error"]);
  expect(kinds("java.lang.IllegalStateException: payment already refunded")).toEqual(["error"]);
  // Nothing failed here.
  expect(kinds("Tests: 10 passed, 0 failed")).toEqual(["normal"]);
  expect(kinds("BUILD SUCCESSFUL in 1m 35s")).toEqual(["normal"]);
});

test("Jenkins Pipeline markup: a block's opening is a heading with its name, the rest is muted", () => {
  const lines = parseLogLines(
    [
      "[Pipeline] stage",
      "[Pipeline] { (Unit tests)",
      "+ ./gradlew test",
      "[Pipeline] }",
      "[Pipeline] // stage",
      "[Pipeline] error",
      "[Pipeline] { (Branch: Lint)",
    ].join("\n"),
  );
  expect(lines.map(line => [line.kind, line.text])).toEqual([
    ["muted", "[Pipeline] stage"],
    ["group", "Unit tests"],
    ["normal", "+ ./gradlew test"],
    ["muted", "[Pipeline] }"],
    ["muted", "[Pipeline] // stage"],
    ["muted", "[Pipeline] error"],
    // A parallel branch opens its stage right after: only the stage is a heading.
    ["muted", "[Pipeline] { (Branch: Lint)"],
  ]);
});
