import { type Accessor, createEffect, createSignal, type Setter, untrack } from "solid-js";

/**
 * State the details keep while a tab is not shown: across tab switches, and across the switch between the side panel
 * and the compact dialog, which mount details of their own. One value per key; the app owns it, so it outlives both.
 */
export type DetailMemory = <T>(key: string, create: () => T) => T;

export function createDetailMemory(): DetailMemory {
  const values = new Map<string, unknown>();
  return <T>(key: string, create: () => T): T => {
    if (!values.has(key)) values.set(key, create());
    return values.get(key) as T;
  };
}

/** The same memory with every key under `prefix`, for a part that names its own keys (one per provider tab). */
export function scopedMemory(memory: DetailMemory, prefix: string): DetailMemory {
  return (key, create) => memory(`${prefix}.${key}`, create);
}

interface Remembered<T> {
  subject: string;
  value: Accessor<T>;
  set: Setter<T>;
}

/** A new value, or how to make it from the current one. Values are never functions (sets, maps, flags). */
export type RememberedUpdate<T> = T | ((previous: T) => T);

/**
 * A signal for one subject (a commit, a file list) that starts from `initial` when the subject changes. With a memory,
 * the memory holds the signal itself: mounted again for the same subject, the view gets it back as it was (a load
 * that finishes after the switch lands there too); for another subject, from `initial`.
 */
export function createRememberedSignal<T>(
  memory: DetailMemory | undefined,
  key: string,
  subject: Accessor<string>,
  initial: () => T,
): [Accessor<T>, (next: RememberedUpdate<T>) => void] {
  const make = (): Remembered<T> => {
    const [value, set] = createSignal<T>(initial());
    return { subject: untrack(subject), value, set };
  };
  const slot = memory ? memory(key, make) : make();
  const restart = (next: string) => {
    slot.subject = next;
    slot.set(() => initial());
  };
  const mountedOn = untrack(subject);
  if (slot.subject !== mountedOn) restart(mountedOn);
  createEffect(() => {
    const next = subject();
    if (next !== slot.subject) restart(next);
  });
  const set = (update: RememberedUpdate<T>) =>
    slot.set(previous => (typeof update === "function" ? (update as (previous: T) => T)(previous) : update));
  return [slot.value, set];
}
