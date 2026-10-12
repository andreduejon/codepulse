import { expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { reExecWith } from "./project-selector";

test("repository re-exec waits for terminal restoration and propagates child status", async () => {
  let restore!: () => void;
  const closed = new Promise<void>(resolve => {
    restore = resolve;
  });
  const destroy = mock(() => {});
  const spawn = spyOn(childProcess, "spawnSync").mockReturnValue({
    status: 7,
  } as childProcess.SpawnSyncReturns<string>);
  const exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
  try {
    const pending = reExecWith("repo with spaces", { destroy, closed });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    restore();
    await pending;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[1]?.at(-1)).toBe("repo with spaces");
    expect(exit).toHaveBeenCalledWith(7);
  } finally {
    restore();
    spawn.mockRestore();
    exit.mockRestore();
  }
});

test("failed terminal restoration never starts replacement process", async () => {
  const spawn = spyOn(childProcess, "spawnSync");
  try {
    await expect(
      reExecWith("repo", { destroy: () => {}, closed: Promise.reject(new Error("restore failed")) }),
    ).rejects.toThrow("restore failed");
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    spawn.mockRestore();
  }
});
