import { createSignal, onCleanup, For, createMemo, createEffect } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useAppState, DEFAULT_AUTO_REFRESH_INTERVAL } from "../../context/state";
import { useTheme, themes } from "../../context/theme";
import { getColorForColumn } from "../../git/graph";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { SHIFT_JUMP } from "../../constants";
import type { ScrollBoxRenderable, Renderable } from "@opentui/core";

type MenuTab = "repository" | "branch";

interface MenuDialogProps {
  onClose: () => void;
  onReload: () => void;
  onFetch: () => void;
  onOpenDialog?: (dialogId: string) => void;
  /** View graph from a specific branch's perspective. null clears the filter. */
  onViewBranch: (branch: string | null) => void;
}

const MAX_COUNT_OPTIONS = [10, 20, 50, 100, 200, 500];

const AUTO_REFRESH_OPTIONS = ["off", "10s", "30s", "60s"];
const AUTO_REFRESH_MS: Record<string, number> = {
  off: 0,
  "10s": 10000,
  "30s": 30000,
  "60s": 60000,
};
const MS_TO_LABEL: Record<number, string> = {
  0: "off",
  10000: "10s",
  30000: "30s",
  60000: "60s",
};

/** Width of the info label column (characters). */
const INFO_LABEL_WIDTH = 12;

/** Persists the last-used tab across dialog open/close cycles. */
let lastMenuTab: MenuTab = "repository";

type SettingItem =
  | { kind: "header"; label: string }
  | { kind: "info"; label: string; get: () => string }
  | { kind: "copyable"; label: string; get: () => string }
  | { kind: "toggle"; label: string; hotkey?: string; get: () => boolean; set: (v: boolean) => void; needsReload?: boolean }
  | { kind: "cycle"; label: string; hotkey?: string; options: string[]; get: () => string; set: (v: string) => void; needsReload?: boolean }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: string; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; get?: () => string; run: () => void; disabled?: () => boolean }
  | { kind: "section"; label: string; count: number; collapsed: () => boolean; toggle: () => void }
  | { kind: "badge"; name: string; colorIndex: number; dimmed?: boolean }
  | { kind: "branch"; name: string; run: () => void };

export default function MenuDialog(props: Readonly<MenuDialogProps>) {
  const { state, actions } = useAppState();
  const { theme, themeName } = useTheme();
  const t = () => theme();

  // ── Tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = createSignal<MenuTab>(lastMenuTab);
  createEffect(() => { lastMenuTab = activeTab(); });

  // ── Clipboard feedback ────────────────────────────────────────────
  const [copiedLabel, setCopiedLabel] = createSignal<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const copyToClipboard = (text: string, label: string) => {
    Bun.spawn(["pbcopy"], { stdin: new Response(text).body });
    setCopiedLabel(label);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopiedLabel(null), 1500);
  };

  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  // ── Banner scroll for selected copyable rows ──────────────────────
  /** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
  const COPYABLE_VISIBLE_WIDTH = 60;
  /** Scrolling speed: shift 1 char every N ms. */
  const BANNER_TICK_MS = 200;
  /** Pause at each end before reversing (ms). */
  const BANNER_PAUSE_MS = 1500;

  const [bannerOffset, setBannerOffset] = createSignal(0);
  const [bannerDirection, setBannerDirection] = createSignal<1 | -1>(1);
  let bannerTimer: ReturnType<typeof setInterval> | undefined;
  let bannerPauseTimer: ReturnType<typeof setTimeout> | undefined;

  const stopBanner = () => {
    if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = undefined; }
    if (bannerPauseTimer) { clearTimeout(bannerPauseTimer); bannerPauseTimer = undefined; }
    setBannerOffset(0);
    setBannerDirection(1);
  };

  const startBanner = (text: string) => {
    const maxOffset = Math.max(0, text.length - COPYABLE_VISIBLE_WIDTH);
    if (maxOffset <= 0) return; // fits, no scrolling needed

    bannerTimer = setInterval(() => {
      setBannerOffset((prev) => {
        const dir = bannerDirection();
        const next = prev + dir;
        if (next >= maxOffset) {
          clearInterval(bannerTimer); bannerTimer = undefined;
          bannerPauseTimer = setTimeout(() => { setBannerDirection(-1); startBanner(text); }, BANNER_PAUSE_MS);
          return maxOffset;
        }
        if (next <= 0) {
          clearInterval(bannerTimer); bannerTimer = undefined;
          bannerPauseTimer = setTimeout(() => { setBannerDirection(1); startBanner(text); }, BANNER_PAUSE_MS);
          return 0;
        }
        return next;
      });
    }, BANNER_TICK_MS);
  };

  // React to cursor / tab changes: restart banner if the newly selected item is copyable + overflows
  createEffect(() => {
    const idx = selectedItemIndex();
    const items = activeItems();
    const item = items[idx];
    stopBanner();
    if (item && item.kind === "copyable") {
      const text = item.get();
      if (text.length > COPYABLE_VISIBLE_WIDTH) {
        bannerPauseTimer = setTimeout(() => startBanner(text), BANNER_PAUSE_MS);
      }
    }
  });

  onCleanup(() => stopBanner());

  /** Returns the visible slice of a copyable value, applying banner offset when selected. */
  const copyableBannerText = (text: string, isSelected: boolean): string => {
    if (text.length <= COPYABLE_VISIBLE_WIDTH) return text;
    if (!isSelected) return text; // let the TUI truncate when not selected
    const off = bannerOffset();
    return text.substring(off, off + COPYABLE_VISIBLE_WIDTH);
  };

  // ── Collapsed state for branch sections ───────────────────────────
  const [localCollapsed, setLocalCollapsed] = createSignal(false);
  const [remoteCollapsed, setRemoteCollapsed] = createSignal(false);

  // ── Repository tab items ──────────────────────────────────────────
  const lastFetchLabel = (): string => {
    if (state.fetching()) return "fetching...";
    const time = state.lastFetchTime();
    if (!time) return "never";
    const secs = Math.round((Date.now() - time.getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  };

  const repoItems: SettingItem[] = [
    { kind: "header", label: "Origin" },
    { kind: "copyable", label: "URL", get: () => state.remoteUrl() || "(none)" },

    { kind: "header", label: "Path" },
    { kind: "copyable", label: "Directory", get: () => state.repoPath() || "(unknown)" },

    { kind: "header", label: "Actions" },
    { kind: "action", label: "Fetch remote", hotkey: "f", get: lastFetchLabel, run: () => props.onFetch() },

    { kind: "header", label: "Preferences" },
    {
      kind: "dialog",
      label: "Color theme",
      hotkey: "ctrl+t",
      dialogId: "theme",
      get: () => themes[themeName()]?.name ?? themeName(),
    },
    {
      kind: "cycle",
      label: "Max commits",
      options: MAX_COUNT_OPTIONS.map(String),
      get: () => String(state.maxCount()),
      set: (v) => actions.setMaxCount(Number.parseInt(v, 10)),
      needsReload: true,
    },
    {
      kind: "toggle",
      label: "Show all branches",
      get: () => state.showAllBranches(),
      set: (v) => actions.setShowAllBranches(v),
      needsReload: true,
    },
    {
      kind: "cycle",
      label: "Auto refresh",
      options: AUTO_REFRESH_OPTIONS,
      get: () => MS_TO_LABEL[state.autoRefreshInterval()] ?? "off",
      set: (v) => actions.setAutoRefreshInterval(AUTO_REFRESH_MS[v] ?? DEFAULT_AUTO_REFRESH_INTERVAL),
    },
  ];

  // ── Branch tab items ──────────────────────────────────────────────
  const localBranches = createMemo(() =>
    state.branches().filter((b) => !b.isRemote)
  );

  const remoteBranches = createMemo(() =>
    state.branches().filter((b) => b.isRemote)
  );

  const makeBranchItem = (b: { name: string }): SettingItem => ({
    kind: "branch" as const,
    name: b.name,
    run: () => {
      // View graph from this branch's perspective
      props.onViewBranch(b.name);
      props.onClose();
    },
  });

  /** Look up the graph color index for a branch name (falls back to 0). */
  const branchColorIndex = (name: string): number => {
    const row = state.graphRows().find((r) => r.branchName === name);
    return row?.nodeColor ?? 0;
  };

  const branchItems = createMemo<SettingItem[]>(() => {
    const locals = localBranches();
    const remotes = remoteBranches();
    const currentBranch = state.currentBranch();

    const result: SettingItem[] = [];

    // ── Checked-out branch (always shown) ──────────────────────────
    result.push({ kind: "header", label: "Checked Out" });
    result.push({
      kind: "badge",
      name: currentBranch || "(unknown)",
      colorIndex: currentBranch ? branchColorIndex(currentBranch) : 0,
      dimmed: !currentBranch,
    });

    // ── Showing filter (always shown) ──────────────────────────────
    result.push({ kind: "header", label: "Showing" });
    const viewing = state.viewingBranch();
    if (viewing) {
      result.push({
        kind: "badge",
        name: viewing,
        colorIndex: branchColorIndex(viewing),
      });
    } else {
      result.push({
        kind: "badge",
        name: "(all branches)",
        colorIndex: 0,
        dimmed: true,
      });
    }

    // ── Actions (always shown) ────────────────────────────────────
    result.push({ kind: "header", label: "Actions" });
    result.push({
      kind: "action",
      label: "Clear filter",
      disabled: () => !state.viewingBranch(),
      run: () => {
        props.onViewBranch(null);
        props.onClose();
      },
    });

    // ── Local section (collapsible) ───────────────────────────────
    result.push({
      kind: "section",
      label: "Local",
      count: locals.length,
      collapsed: localCollapsed,
      toggle: () => setLocalCollapsed((v) => !v),
    });
    if (!localCollapsed()) {
      if (locals.length === 0) {
        result.push({ kind: "info", label: "", get: () => "(no local branches)" });
      } else {
        const sorted = [...locals].sort((a, b) => {
          if (a.isCurrent) return -1;
          if (b.isCurrent) return 1;
          return a.name.localeCompare(b.name);
        });
        for (const b of sorted) {
          result.push(makeBranchItem(b));
        }
      }
    }

    // ── Remote section (collapsible) ──────────────────────────────
    if (remotes.length > 0) {
      result.push({
        kind: "section",
        label: "Remote",
        count: remotes.length,
        collapsed: remoteCollapsed,
        toggle: () => setRemoteCollapsed((v) => !v),
      });
      if (!remoteCollapsed()) {
        const sorted = [...remotes].sort((a, b) => a.name.localeCompare(b.name));
        for (const b of sorted) {
          result.push(makeBranchItem({ name: b.name }));
        }
      }
    }

    return result;
  });

  // ── Active items depend on tab ────────────────────────────────────
  const activeItems = (): SettingItem[] =>
    activeTab() === "repository" ? repoItems : branchItems();

  // ── Cursor per tab ────────────────────────────────────────────────
  const [repoCursor, setRepoCursor] = createSignal(0);
  const [branchCursor, setBranchCursor] = createSignal(0);

  const currentCursor = () => activeTab() === "repository" ? repoCursor() : branchCursor();
  const setCurrentCursor = (v: number | ((prev: number) => number)) =>
    activeTab() === "repository"
      ? setRepoCursor(v as any)
      : setBranchCursor(v as any);

  const selectableIndices = (): number[] =>
    activeItems()
      .map((item, i) =>
        (item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "branch" || item.kind === "section" || item.kind === "copyable"
          || (item.kind === "action" && !(item.disabled?.())))
          ? i
          : -1
      )
      .filter((i) => i >= 0);

  const selectedItemIndex = () => selectableIndices()[currentCursor()];

  const moveCursor = (delta: number) => {
    const indices = selectableIndices();
    const len = indices.length;
    setCurrentCursor((c: number) => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const activateItemAt = (itemIdx: number) => {
    const items = activeItems();
    const item = items[itemIdx];
    if (!item || item.kind === "header" || item.kind === "info" || item.kind === "badge") return;
    if (item.kind === "action" && item.disabled?.()) return;

    if (item.kind === "copyable") {
      copyToClipboard(item.get(), item.label);
    } else if (item.kind === "toggle") {
      item.set(!item.get());
      if (item.needsReload) props.onReload();
    } else if (item.kind === "cycle") {
      const currentVal = item.get();
      const currentIdx = item.options.indexOf(currentVal);
      const nextIdx = (currentIdx + 1) % item.options.length;
      item.set(item.options[nextIdx]);
      if (item.needsReload) props.onReload();
    } else if (item.kind === "dialog") {
      props.onOpenDialog?.(item.dialogId);
    } else if (item.kind === "action") {
      item.run();
    } else if (item.kind === "section") {
      item.toggle();
    } else if (item.kind === "branch") {
      item.run();
    }
  };

  const activateItem = () => activateItemAt(selectedItemIndex());

  // Context-aware verb for the footer
  const footerVerb = (): string => {
    const items = activeItems();
    const item = items[selectedItemIndex()];
    if (!item) return "select";
    switch (item.kind) {
      case "copyable": return "copy";
      case "toggle": return "toggle";
      case "cycle": return "cycle";
      case "dialog": return "open";
      case "action": return "confirm";
      case "section": return item.collapsed() ? "expand" : "collapse";
      case "branch": return "view";
      default: return "select";
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "down":
        moveCursor(e.shift ? SHIFT_JUMP : 1);
        break;
      case "up":
        moveCursor(e.shift ? -SHIFT_JUMP : -1);
        break;
      case "return":
        activateItem();
        break;
      case "left":
        if (activeTab() !== "repository") {
          setActiveTab("repository");
        }
        break;
      case "right":
        if (activeTab() !== "branch") {
          setActiveTab("branch");
        }
        break;
    }
  });

  // ── Scrollbox ref and auto-scroll into view ──────────────────────
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const itemRefs: Renderable[] = [];

  createEffect(() => {
    const idx = selectedItemIndex();
    const sb = scrollboxRef;
    if (!sb || idx == null || idx < 0) return;

    const el = itemRefs[idx];
    if (!el) return;

    const layout = el.getLayoutNode().getComputedLayout();
    const rowTop = layout.top;
    const rowHeight = layout.height;
    const rowBottom = rowTop + rowHeight;

    const viewportHeight = sb.viewport.height;
    const currentScroll = sb.scrollTop;
    const visibleTop = currentScroll;
    const visibleBottom = currentScroll + viewportHeight;

    const padding = 1;

    if (rowTop < visibleTop + padding) {
      sb.scrollTo(Math.max(0, rowTop - padding));
    } else if (rowBottom > visibleBottom - padding) {
      sb.scrollTo(rowBottom - viewportHeight + padding);
    }
  });

  // Format the value display for an item
  const valueDisplay = (item: SettingItem): string => {
    if (item.kind === "header" || item.kind === "branch" || item.kind === "section" || item.kind === "badge") return "";
    if (item.kind === "action") return item.get ? item.get() : "";
    if (item.kind === "info") return item.get();
    if (item.kind === "copyable") return item.get();
    if (item.kind === "toggle") return item.get() ? "on" : "off";
    return item.get();
  };

  return (
    <DialogOverlay>
      <box
        width={70}
        height="70%"
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
      <DialogTitleBar title="Menu" />

      {/* Tab bar with top accent line per selected tab, muted bottom separator */}
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        {/* Repository tab */}
        <box
          flexGrow={1}
          justifyContent="center"
          flexDirection="row"
          border={["top"]}
          borderStyle="single"
          borderColor={activeTab() === "repository" ? t().accent : t().border}
        >
          <text flexShrink={0} wrapMode="none">
            <strong>
              <span fg={activeTab() === "repository" ? t().accent : t().foregroundMuted}>
                {"Repository"}
              </span>
            </strong>
          </text>
        </box>
        {/* Branch tab */}
        <box
          flexGrow={1}
          justifyContent="center"
          flexDirection="row"
          border={["top"]}
          borderStyle="single"
          borderColor={activeTab() === "branch" ? t().accent : t().border}
        >
          <text flexShrink={0} wrapMode="none">
            <strong>
              <span fg={activeTab() === "branch" ? t().accent : t().foregroundMuted}>
                {"Branch"}
              </span>
            </strong>
          </text>
        </box>
      </box>
      {/* Muted separator below tabs */}
      <box width="100%" paddingX={4} flexShrink={0}>
        <box flexGrow={1} border={["top"]} borderStyle="single" borderColor={t().border} />
      </box>

      {/* Items list */}
      <scrollbox ref={scrollboxRef} flexGrow={1} flexShrink={1} minHeight={0} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
        <box flexDirection="column">
        <For each={activeItems()}>
          {(item, itemIndex) => {
            // --- Header ---
            if (item.kind === "header") {
              return (
                <box ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }} flexDirection="column" width="100%" paddingX={4}>
                  {itemIndex() > 0 ? <box height={1} /> : null}
                  <text wrapMode="none" fg={t().accent}>
                    <strong><span fg={t().accent}>{item.label}</span></strong>
                  </text>
                </box>
              );
            }

            // --- Info (non-selectable, dimmed) ---
            if (item.kind === "info") {
              return (
                <box ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }} flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {item.label.padEnd(INFO_LABEL_WIDTH)}
                  </text>
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                    {item.get()}
                  </text>
                </box>
              );
            }

            // --- Badge (non-selectable, colored branch badge) ---
            if (item.kind === "badge") {
              const bgColor = () => item.dimmed
                ? t().backgroundElement
                : getColorForColumn(item.colorIndex, t().graphColors);
              const fgColor = () => item.dimmed
                ? t().foregroundMuted
                : t().background;
              return (
                <box ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }} flexDirection="row" width="100%" paddingX={4}>
                  <text bg={bgColor()} fg={fgColor()} wrapMode="none">
                    {` ${item.name} `}
                  </text>
                </box>
              );
            }

            // --- Copyable (selectable, copies to clipboard on Enter) ---
            if (item.kind === "copyable") {
              const isSel = () => selectedItemIndex() === itemIndex();
              const isCopied = () => copiedLabel() === item.label;
              return (
                <box
                  ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }}
                  flexDirection="row"
                  width="100%"
                  paddingX={4}
                  backgroundColor={isSel() ? t().backgroundElement : undefined}
                >
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                    <span fg={isSel() ? t().primary : t().foreground}>
                      {copyableBannerText(item.get(), isSel())}
                    </span>
                  </text>
                  {isCopied() ? (
                    <text flexShrink={0} wrapMode="none" fg={t().success}>
                      {"  copied!"}
                    </text>
                  ) : null}
                </box>
              );
            }

            // --- Collapsible section header (selectable) ---
            if (item.kind === "section") {
              const isSel = () => selectedItemIndex() === itemIndex();
              const indicator = () => item.collapsed() ? "▸" : "▾";
              return (
                <box ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }} flexDirection="column" width="100%" paddingX={4}>
                  {itemIndex() > 0 ? <box height={1} /> : null}
                  <box
                    flexDirection="row"
                    width="100%"
                    backgroundColor={isSel() ? t().backgroundElement : undefined}
                  >
                    <text flexShrink={0} wrapMode="none" fg={t().accent}>
                      <strong>
                        <span fg={t().accent}>
                          {`${indicator()} ${item.label}`}
                        </span>
                      </strong>
                    </text>
                    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {` (${item.count})`}
                    </text>
                  </box>
                </box>
              );
            }

            // --- Branch list entry (full-width name, no value/hotkey padding) ---
            if (item.kind === "branch") {
              const isSel = () => selectedItemIndex() === itemIndex();
              return (
                <box
                  ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }}
                  flexDirection="row"
                  width="100%"
                  paddingLeft={6}
                  paddingRight={4}
                  backgroundColor={isSel() ? t().backgroundElement : undefined}
                >
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                    <span fg={isSel() ? t().primary : t().foreground}>
                      {item.name}
                    </span>
                  </text>
                </box>
              );
            }

            // --- Selectable items: toggle, cycle, dialog, action ---
            const isDisabledAction = () => item.kind === "action" && !!(item.disabled?.());
            const isSelected = () => !isDisabledAction() && selectedItemIndex() === itemIndex();
            const val = () => valueDisplay(item);

            // Pad value and hotkey to fixed widths for right-alignment
            const paddedVal = () => {
              if (isDisabledAction()) return "";
              const v = val();
              if (!v) return " ".padStart(22);
              if (item.kind === "dialog" || item.kind === "action") return v.padStart(22);
              return `[${v}]`.padStart(22);
            };
            const paddedHotkey = () => {
              if (isDisabledAction()) return "";
              const h = (item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "action")
                ? (item.hotkey ?? "")
                : "";
              return h.padStart(9);
            };

            const labelColor = () =>
              isDisabledAction() ? t().foregroundMuted
              : isSelected() ? t().primary
              : t().foreground;

            return (
              <box
                ref={(el: Renderable) => { itemRefs[itemIndex()] = el; }}
                flexDirection="row"
                width="100%"
                paddingX={4}
                backgroundColor={isSelected() ? t().backgroundElement : undefined}
              >
                {/* Setting name */}
                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                  <span fg={labelColor()}>
                    {item.label}
                  </span>
                </text>

                {/* Current value — right-aligned, in brackets */}
                <text flexShrink={0} wrapMode="none" fg={t().foreground}>
                  <span fg={t().foreground}>{paddedVal()}</span>
                </text>

                {/* Hotkey — right-aligned */}
                <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                  <span fg={t().foregroundMuted}>{paddedHotkey()}</span>
                </text>
              </box>
            );
          }}
        </For>
        </box>
      </scrollbox>

      {/* Spacer between scrollbox and footer area */}
      <box height={1} flexShrink={0} />

      {/* Context-aware footer */}
      <box height={1} flexShrink={0} />
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>enter</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{` ${footerVerb()}  `}</text>
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>←/→</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" switch tab  "}</text>
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>↑/↓</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" navigate"}</text>
      </box>
      <box height={1} flexShrink={0} />
      </box>
    </DialogOverlay>
  );
}
