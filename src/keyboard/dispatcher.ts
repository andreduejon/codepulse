/**
 * Every key handler of the app goes through one listener per renderer. Handlers see a key in the order they mounted,
 * until one calls `stopPropagation()`, as with OpenTUI's own listeners. One difference: a handler removed while a key
 * is being handled (a dialog an earlier handler just closed) doesn't see that key. OpenTUI calls every listener it had
 * when the key came, so a closed dialog's handler ran against props that were gone ("Stale read from <Show>").
 */
import type { KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, onMount } from "solid-js";

export type KeyHandler = (event: KeyEvent) => void;

interface KeyDispatcher {
  /** Mounted handlers, oldest first. */
  handlers: KeyHandler[];
}

/** One dispatcher per renderer (the app's, or each test's): no state outlives its renderer. */
const dispatchers = new WeakMap<object, KeyDispatcher>();

function dispatcherFor(renderer: ReturnType<typeof useRenderer>): KeyDispatcher {
  const existing = dispatchers.get(renderer);
  if (existing) return existing;
  const dispatcher: KeyDispatcher = { handlers: [] };
  renderer.keyInput.on("keypress", (event: KeyEvent) => {
    for (const handler of [...dispatcher.handlers]) {
      if (!dispatcher.handlers.includes(handler)) continue;
      try {
        handler(event);
      } catch (error) {
        console.error("[keys] Error in a key handler:", error);
      }
      if (event.propagationStopped) return;
    }
  });
  dispatchers.set(renderer, dispatcher);
  return dispatcher;
}

/** Handles keys while the calling component is mounted, in place of OpenTUI's `useKeyboard`. */
export function useKeys(handler: KeyHandler): void {
  const renderer = useRenderer();
  onMount(() => dispatcherFor(renderer).handlers.push(handler));
  onCleanup(() => {
    const handlers = dispatcherFor(renderer).handlers;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  });
}
