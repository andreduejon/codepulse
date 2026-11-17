import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { OPEN_ROW_SHORTCUT, type RowShortcut, useOpenRowShortcut } from "./open-row";

const navRef = (): DetailNavRef => ({
  itemCount: 0,
  activateCurrentItem: () => false,
  lastJumpFrom: null,
  pendingJumpDirection: null,
  scrollToFile: () => {},
  itemRefs: [],
});

test("a tab that unmounts after its replacement mounted leaves the replacement's `o open` hint", async () => {
  const nav = navRef();
  const [shortcut, setShortcut] = createSignal<RowShortcut | null>(null);
  const mount = () =>
    createRoot(dispose => {
      useOpenRowShortcut({
        navRef: nav,
        detailFocused: () => true,
        url: () => "https://example.invalid/run/1",
        setDetailCursorShortcut: setShortcut,
      });
      return dispose;
    });
  // The other layout's details mount first, then the old ones go: the order a resize between the layouts takes.
  const disposeOld = mount();
  await Promise.resolve();
  const disposeNew = mount();
  await Promise.resolve();
  disposeOld();
  expect(shortcut()).toEqual(OPEN_ROW_SHORTCUT);
  expect(nav.handleKey).toBeDefined();
  disposeNew();
  expect(shortcut()).toBeNull();
  expect(nav.handleKey).toBeUndefined();
});
