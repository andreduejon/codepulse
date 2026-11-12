import { expect, test } from "bun:test";
import { sliceStageLog } from "./stage-log";

const consoleLog = [
  "Started by user admin",
  "[Pipeline] Start of Pipeline",
  "[Pipeline] node",
  "[Pipeline] {",
  "[Pipeline] stage",
  "[Pipeline] { (Checkout)",
  "[Pipeline] checkout",
  "Cloning repository",
  "[Pipeline] }",
  "[Pipeline] // stage",
  "[Pipeline] stage",
  "[Pipeline] { (Test)",
  "[Pipeline] sh",
  "+ ./gradlew test",
  "[Pipeline] {",
  "inner block",
  "[Pipeline] }",
  "PaymentServiceTest > refundsTwice() FAILED",
  "[Pipeline] }",
  "[Pipeline] // stage",
  "[Pipeline] }",
  "[Pipeline] End of Pipeline",
  "Finished: UNSTABLE",
].join("\n");

test("a stage's log is its block in the console, nested blocks included", () => {
  expect(sliceStageLog(consoleLog, "Test")?.log).toBe(
    [
      "[Pipeline] { (Test)",
      "[Pipeline] sh",
      "+ ./gradlew test",
      "[Pipeline] {",
      "inner block",
      "[Pipeline] }",
      "PaymentServiceTest > refundsTwice() FAILED",
      "[Pipeline] }",
    ].join("\n"),
  );
  expect(sliceStageLog(consoleLog, "Checkout")?.log).toBe(
    ["[Pipeline] { (Checkout)", "[Pipeline] checkout", "Cloning repository", "[Pipeline] }"].join("\n"),
  );
});

test("a stage still running has its block so far; an unknown stage has none", () => {
  const running = consoleLog.split("\n").slice(0, 14).join("\n");
  expect(sliceStageLog(running, "Test")?.log).toBe(
    ["[Pipeline] { (Test)", "[Pipeline] sh", "+ ./gradlew test"].join("\n"),
  );
  expect(sliceStageLog(consoleLog, "Deploy")).toEqual({ missing: "absent" });
});

test("a stage in a parallel branch has no slice: its lines mix with the other branches' in the console", () => {
  const parallel = [
    "[Pipeline] stage",
    "[Pipeline] { (Tests)",
    "[Pipeline] parallel",
    "[Pipeline] { (Branch: Unit)",
    "[Pipeline] { (Branch: Lint)",
    "[Pipeline] stage",
    "[Pipeline] { (Unit)",
    "[Pipeline] stage",
    "[Pipeline] { (Lint)",
    "+ npm test",
    "+ npm run lint",
    "[Pipeline] }",
    "[Pipeline] }",
    "[Pipeline] }",
    "[Pipeline] }",
    "[Pipeline] // parallel",
    "[Pipeline] }",
    "[Pipeline] stage",
    "[Pipeline] { (Deploy)",
    "+ ./deploy.sh",
    "[Pipeline] }",
  ].join("\n");
  expect(sliceStageLog(parallel, "Unit")).toEqual({ missing: "parallel" });
  expect(sliceStageLog(parallel, "Lint")).toEqual({ missing: "parallel" });
  // The stage around the parallel block and the stages after it still have their part.
  expect(sliceStageLog(parallel, "Deploy")).toEqual({ log: "[Pipeline] { (Deploy)\n+ ./deploy.sh\n[Pipeline] }" });
  expect(sliceStageLog(parallel, "Tests")).toHaveProperty("log");
});
