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
  expect(sliceStageLog(consoleLog, "Test")).toBe(
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
  expect(sliceStageLog(consoleLog, "Checkout")).toBe(
    ["[Pipeline] { (Checkout)", "[Pipeline] checkout", "Cloning repository", "[Pipeline] }"].join("\n"),
  );
});

test("a stage still running has its block so far; an unknown stage has none", () => {
  const running = consoleLog.split("\n").slice(0, 14).join("\n");
  expect(sliceStageLog(running, "Test")).toBe(["[Pipeline] { (Test)", "[Pipeline] sh", "+ ./gradlew test"].join("\n"));
  expect(sliceStageLog(consoleLog, "Deploy")).toBeNull();
});
