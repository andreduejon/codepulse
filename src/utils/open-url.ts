export function openUrl(url: string | undefined): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;

  try {
    if (process.platform === "darwin") {
      Bun.spawn(["open", parsed.toString()]);
    } else if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", parsed.toString()]);
    } else {
      Bun.spawn(["xdg-open", parsed.toString()]);
    }
  } catch {
    // Browser opener missing; ignore.
  }
}
