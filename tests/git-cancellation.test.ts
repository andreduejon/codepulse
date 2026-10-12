import { expect, spyOn, test } from "bun:test";
import { runGit } from "../src/git/repo-git";

test("Windows Git abort kills and awaits helper process tree without shell interpolation", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const controller = new AbortController();
  let finishGit!: (code: number) => void;
  let finishCleanup!: (code: number) => void;
  const exited = new Promise<number>(resolve => {
    finishGit = resolve;
  });
  const cleanup = new Promise<number>(resolve => {
    finishCleanup = resolve;
  });
  const spawn = spyOn(Bun, "spawn").mockImplementation((command: unknown) => {
    if ((command as string[])[0] === "taskkill.exe") return { exited: cleanup } as ReturnType<typeof Bun.spawn>;
    return {
      pid: 12345,
      stdout: new Response("").body,
      stderr: new Response("").body,
      exited,
      exitCode: 1,
    } as ReturnType<typeof Bun.spawn>;
  });
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    let settled = false;
    const result = runGit("C:\\repo with spaces", ["status"], controller.signal).then(value => {
      settled = true;
      return value;
    });
    controller.abort();
    expect(spawn).toHaveBeenLastCalledWith(["taskkill.exe", "/PID", "12345", "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    finishGit(1);
    await Bun.sleep(0);
    expect(settled).toBe(false);
    finishCleanup(0);
    expect((await result).exitCode).toBe(1);
  } finally {
    finishGit(1);
    finishCleanup(0);
    if (platform) Object.defineProperty(process, "platform", platform);
    spawn.mockRestore();
  }
});
