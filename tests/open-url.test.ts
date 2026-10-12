import { expect, spyOn, test } from "bun:test";
import { openUrl } from "../src/utils/open-url";

test("Windows browser opener keeps URL metacharacters out of executable script", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({}) as ReturnType<typeof Bun.spawn>);
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    const url = "https://example.test/build?a=1&b=%22%26calc.exe";
    openUrl(url);
    expect(spawn).toHaveBeenCalledWith(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $env:CODEPULSE_OPEN_URL",
      ],
      { env: { ...process.env, CODEPULSE_OPEN_URL: new URL(url).toString() } },
    );
    openUrl("file:///tmp/test");
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
    spawn.mockRestore();
  }
});
