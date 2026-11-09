import type { KeyEvent } from "@opentui/core";
import { createEffect, onCleanup } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { openUrl } from "../../utils/open-url";

export type RowShortcut = { key: string; desc: string };

export const OPEN_ROW_SHORTCUT: RowShortcut = { key: "o", desc: "open" };

/**
 * `o` opens the selected row's web page (a CI run or job, an OpenShift resource, a Snyk finding). The footer offers it
 * only while the cursor is on a row that has one, so rows without a page stay quiet.
 *
 * Installs `navRef.handleKey` for the tab; a tab with other row keys passes them as `otherKeys`.
 */
export function useOpenRowShortcut(
  opts: Readonly<{
    navRef?: DetailNavRef;
    detailFocused: () => boolean;
    /** The cursored row's page, or nothing. */
    url: () => string | null | undefined;
    setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
    otherKeys?: (event: KeyEvent) => boolean;
  }>,
): void {
  const currentUrl = () => (opts.detailFocused() ? opts.url() || null : null);
  const handleKey = (event: KeyEvent) => {
    if (opts.otherKeys?.(event)) return true;
    if (event.name !== "o" || event.ctrl || event.meta || event.shift) return false;
    const url = currentUrl();
    if (!url) return false;
    openUrl(url);
    return true;
  };

  createEffect(() => opts.setDetailCursorShortcut?.(currentUrl() ? OPEN_ROW_SHORTCUT : null));
  createEffect(() => {
    if (opts.navRef) opts.navRef.handleKey = handleKey;
  });
  onCleanup(() => {
    if (opts.navRef?.handleKey === handleKey) opts.navRef.handleKey = undefined;
    opts.setDetailCursorShortcut?.(null);
  });
}
