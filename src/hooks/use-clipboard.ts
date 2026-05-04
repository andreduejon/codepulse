import type { Accessor } from "solid-js";
import { createSignal, onCleanup } from "solid-js";

/**
 * Cross-platform clipboard hook with "copied" feedback.
 *
 * Returns:
 *   - `copiedId()` — the identifier passed to the most recent successful copy,
 *     auto-clears to `null` after 1500 ms.
 *   - `copyToClipboard(text, id)` — spawns the platform clipboard utility and
 *     sets `copiedId` on success.
 *
 * The generic parameter `T` lets callers use a narrow string-union type as the
 * identifier (e.g. `CopyableField`) rather than plain `string`.
 *
 * Platform support: macOS (`pbcopy`), Windows / WSL (`clip.exe`),
 * Linux Wayland (`wl-copy`), Linux X11 (`xclip -selection clipboard`).
 */
export function useClipboard<T extends string = string>(): {
  copiedId: Accessor<T | null>;
  copyToClipboard: (text: string, id: T) => void;
} {
  const [copiedId, setCopiedId] = createSignal<T | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const copyToClipboard = (text: string, id: T) => {
    try {
      let cmd: string[];
      if (process.platform === "darwin") {
        cmd = ["pbcopy"];
      } else if (process.platform === "win32") {
        cmd = ["clip.exe"];
      } else if (process.env.WAYLAND_DISPLAY) {
        // Wayland session: prefer wl-copy over xclip (xclip doesn't work on Wayland)
        cmd = ["wl-copy"];
      } else {
        cmd = ["xclip", "-selection", "clipboard"];
      }
      const proc = Bun.spawn(cmd, { stdin: new Response(text).body });
      // Kill after 5 s to prevent zombie if clipboard utility hangs (e.g. xclip without X11)
      const killTimer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
      }, 5000);
      proc.exited.then(() => clearTimeout(killTimer)).catch(() => clearTimeout(killTimer));
      setCopiedId(() => id);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard utility not available — silently ignore
    }
  };

  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  return { copiedId, copyToClipboard };
}
