import type { Renderable } from "@opentui/core";
import { type Accessor, createEffect, onCleanup, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";

/**
 * What every provider tree (CI runs, OpenShift, Snyk) shares with the keyboard handler: each row registers its element
 * under its key, `navRef` gets the elements in cursor order, the row count and what Enter does, and the cursor stays
 * on a row. `navRef` keeps the last tab's count when it goes: the compact dialog's footer reads it while the other
 * layout's tab mounts (it is not reactive), and a 0 there would leave Enter unclickable.
 */
export function useDetailTree(
  opts: Readonly<{
    navRef?: DetailNavRef;
    /** Every row's key, in cursor order. */
    keys: Accessor<readonly string[]>;
    activate: () => boolean;
    detailCursorIndex: () => number;
    setDetailCursorIndex: (index: number) => void;
  }>,
): {
  /** The `ref` of the row with this key. A row that goes stays out of `navRef`, which follows `keys`. */
  ref: (key: string) => (element: Renderable) => void;
} {
  const refsByKey = new Map<string, Renderable>();
  const indexByKey = new Map<string, number>();
  const itemRefs: Renderable[] = [];

  createEffect(() => {
    const keys = opts.keys();
    indexByKey.clear();
    itemRefs.length = keys.length;
    keys.forEach((key, index) => {
      indexByKey.set(key, index);
      itemRefs[index] = refsByKey.get(key) as Renderable;
    });
    if (!opts.navRef) return;
    opts.navRef.itemRefs = itemRefs;
    opts.navRef.itemCount = keys.length;
    opts.navRef.activateCurrentItem = opts.activate;
  });

  createEffect(() => {
    const count = opts.keys().length;
    const cursor = untrack(opts.detailCursorIndex);
    if (count === 0) opts.setDetailCursorIndex(0);
    else if (cursor < 0 || cursor >= count) opts.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  onCleanup(() => {
    refsByKey.clear();
    indexByKey.clear();
    itemRefs.length = 0;
    // Enter must not reach a tree that is gone (the dashboard's Info fallback has no rows of its own). Only its own
    // action: another view may have taken the ref already.
    if (opts.navRef && opts.navRef.activateCurrentItem === opts.activate) opts.navRef.activateCurrentItem = () => false;
  });

  const ref = (key: string) => (element: Renderable) => {
    refsByKey.set(key, element);
    const index = indexByKey.get(key);
    if (index !== undefined) itemRefs[index] = element;
  };
  return { ref };
}
