import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { relaunch } from "./relaunch";

test("the new process gets the path as one argument, and its exit status is passed on", async () => {
  const spawn = spyOn(childProcess, "spawnSync").mockReturnValue({
    status: 7,
  } as childProcess.SpawnSyncReturns<string>);
  const exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
  try {
    await relaunch("repo with spaces");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[1]?.at(-1)).toBe("repo with spaces");
    expect(exit).toHaveBeenCalledWith(7);
  } finally {
    spawn.mockRestore();
    exit.mockRestore();
  }
});
