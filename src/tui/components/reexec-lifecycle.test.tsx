import { expect, mock, test } from "bun:test";
import { reExecWith } from "./project-selector";

test("switching repository waits for the terminal to be restored, then starts again on it", async () => {
  let restore!: () => void;
  const closed = new Promise<void>(resolve => {
    restore = resolve;
  });
  const destroy = mock(() => {});
  const relaunch = mock(async (_repoPath: string) => {});
  const pending = reExecWith("repo with spaces", { destroy, closed }, relaunch);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(relaunch).not.toHaveBeenCalled();
  restore();
  await pending;
  expect(relaunch).toHaveBeenCalledWith("repo with spaces");
});

test("a failed terminal restore never starts the new process", async () => {
  const relaunch = mock(async (_repoPath: string) => {});
  await expect(
    reExecWith("repo", { destroy: () => {}, closed: Promise.reject(new Error("restore failed")) }, relaunch),
  ).rejects.toThrow("restore failed");
  expect(relaunch).not.toHaveBeenCalled();
});
