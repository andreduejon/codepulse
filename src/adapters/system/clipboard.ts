/**
 * The platform's clipboard tool: macOS (`pbcopy`), Windows / WSL (`clip.exe`), Linux Wayland (`wl-copy`), Linux X11
 * (`xclip -selection clipboard`). A missing tool is ignored; one that hangs is stopped after 5 s.
 */
export function copyToClipboard(text: string): boolean {
  try {
    let cmd: string[];
    if (process.platform === "darwin") cmd = ["pbcopy"];
    else if (process.platform === "win32") cmd = ["clip.exe"];
    // Wayland session: prefer wl-copy over xclip (xclip doesn't work on Wayland)
    else if (process.env.WAYLAND_DISPLAY) cmd = ["wl-copy"];
    else cmd = ["xclip", "-selection", "clipboard"];
    const proc = Bun.spawn(cmd, { stdin: new Response(text).body });
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, 5000);
    proc.exited.then(() => clearTimeout(killTimer)).catch(() => clearTimeout(killTimer));
    return true;
  } catch {
    return false;
  }
}
