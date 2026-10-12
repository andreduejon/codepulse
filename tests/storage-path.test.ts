import { expect, test } from "bun:test";
import { join } from "node:path";
import { storageRoot } from "../src/utils/storage-path";

test("Windows storage uses separate roaming config and local cache with home fallbacks", () => {
  const home = "C:\\Users\\Test User";
  const env = { APPDATA: "D:\\Roaming Data", LOCALAPPDATA: "D:\\Local Data" };
  expect(storageRoot("config", "win32", home, env)).toBe("D:\\Roaming Data\\codepulse");
  expect(storageRoot("cache", "win32", home, env)).toBe("D:\\Local Data\\codepulse\\Cache");
  expect(storageRoot("config", "win32", home, {})).toBe(`${home}\\AppData\\Roaming\\codepulse`);
  expect(storageRoot("cache", "win32", home, { LOCALAPPDATA: "" })).toBe(`${home}\\AppData\\Local\\codepulse\\Cache`);
});

test("Unix storage retains existing config/cache paths regardless of Windows environment", () => {
  for (const platform of ["darwin", "linux"] as const) {
    expect(storageRoot("config", platform, "/home/user", { APPDATA: "ignored" })).toBe(
      join("/home/user", ".config", "codepulse"),
    );
    expect(storageRoot("cache", platform, "/home/user", { LOCALAPPDATA: "ignored" })).toBe(
      join("/home/user", ".cache", "codepulse"),
    );
  }
});
