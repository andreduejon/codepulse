import type { Accessor } from "solid-js";
import { createSignal, onCleanup } from "solid-js";
import { useSystem } from "../context/system";

/**
 * Cross-platform clipboard hook with "copied" feedback.
 *
 * Returns:
 *   - `copiedId()` — the identifier passed to the most recent successful copy,
 *     auto-clears to `null` after 1500 ms.
 *   - `copyToClipboard(text, id)` — copies through the app's system port and
 *     sets `copiedId` on success.
 *
 * The generic parameter `T` lets callers use a narrow string-union type as the
 * identifier (e.g. `CopyableField`) rather than plain `string`.
 */
export function useClipboard<T extends string = string>(): {
  copiedId: Accessor<T | null>;
  copyToClipboard: (text: string, id: T) => void;
} {
  const [copiedId, setCopiedId] = createSignal<T | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const system = useSystem();
  const copyToClipboard = (text: string, id: T) => {
    if (!system.copyToClipboard(text)) return;
    setCopiedId(() => id);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopiedId(null), 1500);
  };

  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  return { copiedId, copyToClipboard };
}
