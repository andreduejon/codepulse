import { homedir } from "node:os";
import { join, win32 } from "node:path";

/** Preserve existing Unix locations; use Windows per-user application folders. */
export function storageRoot(
  kind: "config" | "cache",
  platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") return join(home, kind === "config" ? ".config" : ".cache", "codepulse");
  if (kind === "config") {
    return win32.join(env.APPDATA || win32.join(home, "AppData", "Roaming"), "codepulse");
  }
  return win32.join(env.LOCALAPPDATA || win32.join(home, "AppData", "Local"), "codepulse", "Cache");
}
