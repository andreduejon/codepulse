import { expect, test } from "bun:test";
import type { DashboardRow } from "../../core/dashboard/events";
import { BRANCH_MAX, branchColumnWidth, cutBranch } from "./layout";

const eventRow = (branch?: string) => ({ kind: "event", event: { branch } }) as DashboardRow;

test("the Branch column fits the longest branch shown, never less than its header and never more than the cut", () => {
  expect(branchColumnWidth([])).toBe("Branch".length + 1);
  expect(branchColumnWidth([eventRow("main"), eventRow()])).toBe("Branch".length + 1);
  expect(branchColumnWidth([eventRow("release/1.x"), eventRow("main")])).toBe("release/1.x".length + 1);
  expect(branchColumnWidth([eventRow("feature/payments-retry-with-a-long-name")])).toBe(BRANCH_MAX + 1);
});

test("a branch longer than the column ends in …", () => {
  expect(cutBranch("main")).toBe("main");
  expect(cutBranch("feature/payments-retry-with-a-long-name")).toBe("feature/payments-re…");
  expect(cutBranch("feature/payments-retry-with-a-long-name")).toHaveLength(BRANCH_MAX);
});
