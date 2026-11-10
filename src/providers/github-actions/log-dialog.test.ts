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

test("test runners' failure lines are errors: Bun's (fail), Jest's and Vitest's ✕ and ×, and FAIL", () => {
  expect(kinds("(fail) retry > charges once after a timeout [12.1ms]")).toEqual(["error"]);
  expect(kinds("  ✕ adds 1 + 2 (5 ms)")).toEqual(["error"]);
  expect(kinds(" × src/sum.test.ts > adds")).toEqual(["error"]);
  expect(kinds("FAIL src/sum.test.js")).toEqual(["error"]);
  expect(kinds(" FAIL  src/sum.test.ts > adds")).toEqual(["error"]);
  // Passing lines stay plain.
  expect(kinds("(pass) cart > adds an item [0.42ms]")).toEqual(["normal"]);
  expect(kinds("  ✓ adds 1 + 2 (2 ms)")).toEqual(["normal"]);
  expect(kinds("PASS src/sum.test.js")).toEqual(["normal"]);
  expect(kinds("Image size 3 × 4")).toEqual(["normal"]);
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
