/**
 * Every key handler of the app goes through one listener per renderer, newest first: what opened last (a dialog over
 * the graph, a search row in a log) sees a key before what is below it. A modal handler (a dialog, a screen) keeps every
 * key from the handlers below it; any handler can keep one key from them with `stopPropagation()`. A handler removed
 * while a key is being handled (a dialog closed by the key) doesn't see that key, so no handler runs against props
 * that are gone ("Stale read from <Show>").
 */
import type { KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, onMount } from "solid-js";

export type KeyHandler = (event: KeyEvent) => void;

interface Registration {
  handler: KeyHandler;
  modal: boolean;
}

interface KeyDispatcher {
  /** Mounted handlers, oldest first. */
  registrations: Registration[];
}

/** One dispatcher per renderer (the app's, or each test's): no state outlives its renderer. */
const dispatchers = new WeakMap<object, KeyDispatcher>();

function dispatcherFor(renderer: ReturnType<typeof useRenderer>): KeyDispatcher {
  const existing = dispatchers.get(renderer);
  if (existing) return existing;
  const dispatcher: KeyDispatcher = { registrations: [] };
  renderer.keyInput.on("keypress", (event: KeyEvent) => {
    for (const registration of [...dispatcher.registrations].reverse()) {
      if (!dispatcher.registrations.includes(registration)) continue;
      try {
        registration.handler(event);
      } catch (error) {
        console.error("[keys] Error in a key handler:", error);
      }
      if (registration.modal || event.propagationStopped) return;
    }
  });
  dispatchers.set(renderer, dispatcher);
  return dispatcher;
}

/**
 * Handles keys while the calling component is mounted, in place of OpenTUI's `useKeyboard`. `modal`: the handlers
 * mounted before it (the app's, beneath a dialog) see no key while it is.
 */
export function useKeys(handler: KeyHandler, options: { modal?: boolean } = {}): void {
  const renderer = useRenderer();
  const registration: Registration = { handler, modal: options.modal ?? false };
  onMount(() => dispatcherFor(renderer).registrations.push(registration));
  onCleanup(() => {
    const registrations = dispatcherFor(renderer).registrations;
    const index = registrations.indexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  });
}

/** Keys for a dialog or a screen: nothing beneath it (the app's keys) sees a key while it is open. */
export function useModalKeys(handler: KeyHandler): void {
  useKeys(handler, { modal: true });
}
