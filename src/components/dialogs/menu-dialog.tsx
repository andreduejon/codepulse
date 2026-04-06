import { homedir } from "node:os";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup } from "solid-js";
import type { CodepulseConfig, ConfigInfo } from "../../config";
import { writeConfig } from "../../config";
import { DEFAULT_MAX_COUNT, SHIFT_JUMP } from "../../constants";
import { DEFAULT_AUTO_REFRESH_INTERVAL, useAppState } from "../../context/state";
import { themes, useTheme } from "../../context/theme";
import { getColorForColumn } from "../../git/graph";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { scrollElementIntoView } from "../../utils/scroll";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

type MenuTab = "repository" | "branch";

interface MenuDialogProps {
  onClose: () => void;
  onReload: () => void;
  onFetch: () => void;
  onOpenDialog?: (dialogId: string) => void;
  /** View graph from a specific branch's perspective. null clears the filter. */
  onViewBranch: (branch: string | null) => void;
  /** Config file info from startup, used by the Configuration section. */
  configInfo?: ConfigInfo;
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
const [lastMenuTab, setLastMenuTab] = createSignal<MenuTab>("repository");

type SettingItem =
  | { kind: "header"; label: string }
  | { kind: "info"; label: string; get: () => string }
  | { kind: "copyable"; label: string; get: () => string }
  | {
      kind: "toggle";
      label: string;
      hotkey?: string;
      get: () => boolean;
      set: (v: boolean) => void;
      needsReload?: boolean;
    }
  | {
      kind: "cycle";
      label: string;
      hotkey?: string;
      options: string[];
      get: () => string;
      set: (v: string) => void;
      needsReload?: boolean;
    }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: string; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; get?: () => string; run: () => void; disabled?: () => boolean }
  | { kind: "section"; label: string; count: number; collapsed: () => boolean; toggle: () => void }
  | { kind: "badge"; name: string; colorIndex: number; dimmed?: boolean }
  | { kind: "branch"; name: string; run: () => void; upstream?: string; ahead?: number; behind?: number };

export default function MenuDialog(props: Readonly<MenuDialogProps>) {
  const { state, actions } = useAppState();
  const { theme, themeName, setTheme } = useTheme();
  const t = () => theme();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.7), dimensions().height - 8);

  // ── Tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = createSignal<MenuTab>(lastMenuTab());
  createEffect(() => {
    setLastMenuTab(activeTab());
  });

  // ── Clipboard feedback ────────────────────────────────────────────
  const { copiedId: copiedLabel, copyToClipboard } = useClipboard();

  // ── Config save feedback ──────────────────────────────────────────
  const [savedFeedback, setSavedFeedback] = createSignal<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  const showSavedFeedback = (label: string) => {
    setSavedFeedback(label);
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => setSavedFeedback(null), 1500);
  };
  onCleanup(() => {
    if (savedTimer) clearTimeout(savedTimer);
  });

  // ── Config save scope ──────────────────────────────────────────────
  type ConfigScope = "global" | "this repo";
  const [configScope, setConfigScope] = createSignal<ConfigScope>("global");

  // ── Banner scroll for selected copyable rows ──────────────────────
  /** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
  const COPYABLE_VISIBLE_WIDTH = 60;

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

  const repoItems = createMemo<SettingItem[]>(() => {
    const items: SettingItem[] = [
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
        label: "Page size",
        options: MAX_COUNT_OPTIONS.map(String),
        get: () => String(state.maxCount()),
        set: v => actions.setMaxCount(Number.parseInt(v, 10)),
        needsReload: true,
      },
      {
        kind: "toggle",
        label: "Show all branches",
        get: () => state.showAllBranches(),
        set: v => actions.setShowAllBranches(v),
        needsReload: true,
      },
      {
        kind: "cycle",
        label: "Auto refresh",
        options: AUTO_REFRESH_OPTIONS,
        get: () => MS_TO_LABEL[state.autoRefreshInterval()] ?? "off",
        set: v => actions.setAutoRefreshInterval(AUTO_REFRESH_MS[v] ?? DEFAULT_AUTO_REFRESH_INTERVAL),
      },
      {
        kind: "action",
        label: "Reset to defaults",
        run: () => {
          setTheme("catppuccin-mocha");
          actions.setMaxCount(DEFAULT_MAX_COUNT);
          actions.setShowAllBranches(true);
          actions.setAutoRefreshInterval(DEFAULT_AUTO_REFRESH_INTERVAL);
          props.onReload();
        },
      },
    ];

    // ── Configuration section (only when configInfo is available) ──
    const ci = props.configInfo;
    if (ci) {
      const shortenHome = (p: string) =>
        p.replace(new RegExp(`^${homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "~");

      items.push({ kind: "header", label: "Configuration" });
      items.push({
        kind: "info",
        label: "Config file",
        get: () => `${shortenHome(ci.globalPath)}  ${ci.globalExists ? "(found)" : "(not found)"}`,
      });
      items.push({
        kind: "cycle",
        label: "Save scope",
        options: ["global", "this repo"],
        get: () => configScope(),
        set: v => setConfigScope(v as ConfigScope),
      });
      items.push({
        kind: "action",
        label: "Save to config",
        get: () => (savedFeedback() === "Save to config" ? "\u2713 Saved!" : ""),
        run: () => {
          const autoRefreshMs = state.autoRefreshInterval();
          const cfg: CodepulseConfig = {
            theme: themeName(),
            pageSize: state.maxCount(),
            showAllBranches: state.showAllBranches(),
            autoRefreshSeconds: autoRefreshMs / 1000,
          };
          const scope = configScope() === "global" ? ("global" as const) : ("repo" as const);
          const ok = writeConfig(cfg, scope, scope === "repo" ? state.repoPath() : undefined);
          if (ok) {
            ci.globalExists = true;
            if (scope === "repo") ci.hasRepoOverrides = true;
            showSavedFeedback("Save to config");
          }
        },
      });
    }

    return items;
  });

  // ── Branch tab items ──────────────────────────────────────────────
  const localBranches = createMemo(() => state.branches().filter(b => !b.isRemote));

  const remoteBranches = createMemo(() => state.branches().filter(b => b.isRemote));

  const makeBranchItem = (b: { name: string; upstream?: string; ahead?: number; behind?: number }): SettingItem => ({
    kind: "branch" as const,
    name: b.name,
    upstream: b.upstream,
    ahead: b.ahead,
    behind: b.behind,
    run: () => {
      // View graph from this branch's perspective
      props.onViewBranch(b.name);
      props.onClose();
    },
  });

  /** Pre-built map from branch name → graph color index (O(1) lookup). */
  const branchColorMap = createMemo(() => {
    const map = new Map<string, number>();
    for (const r of state.graphRows()) {
      if (r.branchName && !map.has(r.branchName)) {
        map.set(r.branchName, r.nodeColor);
      }
    }
    return map;
  });

  /** Look up the graph color index for a branch name (falls back to 0). */
  const branchColorIndex = (name: string): number => branchColorMap().get(name) ?? 0;

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
      toggle: () => setLocalCollapsed(v => !v),
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
        toggle: () => setRemoteCollapsed(v => !v),
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

  /** Max column widths for ahead/behind counts across all visible branch items. */
  const branchTrackWidths = createMemo(() => {
    let addW = 0;
    let delW = 0;
    for (const item of branchItems()) {
      if (item.kind !== "branch" || item.upstream == null) continue;
      addW = Math.max(addW, `↑${item.ahead ?? 0}`.length);
      delW = Math.max(delW, `↓${item.behind ?? 0}`.length);
    }
    return { addColWidth: addW, delColWidth: delW };
  });

  // ── Active items depend on tab ────────────────────────────────────
  const activeItems = (): SettingItem[] => (activeTab() === "repository" ? repoItems() : branchItems());

  // ── Cursor per tab ────────────────────────────────────────────────
  const [repoCursor, setRepoCursor] = createSignal(0);
  const [branchCursor, setBranchCursor] = createSignal(0);

  const currentCursor = () => (activeTab() === "repository" ? repoCursor() : branchCursor());
  const setCurrentCursor = (v: number | ((prev: number) => number)) => {
    const setter = activeTab() === "repository" ? setRepoCursor : setBranchCursor;
    if (typeof v === "function") setter(v);
    else setter(v);
  };

  const selectableIndices = (): number[] =>
    activeItems()
      .map((item, i) =>
        item.kind === "toggle" ||
        item.kind === "cycle" ||
        item.kind === "dialog" ||
        item.kind === "branch" ||
        item.kind === "section" ||
        item.kind === "copyable" ||
        (item.kind === "action" && !item.disabled?.())
          ? i
          : -1,
      )
      .filter(i => i >= 0);

  const selectedItemIndex = () => selectableIndices()[currentCursor()];

  // Overflow memo for the currently-selected copyable item
  // NOTE: must be placed after selectedItemIndex/activeItems to avoid TDZ with createMemo's eager evaluation
  const bannerOverflow = createMemo(() => {
    const idx = selectedItemIndex();
    const items = activeItems();
    const item = items[idx];
    if (!item || item.kind !== "copyable") return 0;
    return Math.max(0, item.get().length - COPYABLE_VISIBLE_WIDTH);
  });
  const bannerOffset = useBannerScroll(bannerOverflow);

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
      case "copyable":
        return "copy";
      case "toggle":
        return "toggle";
      case "cycle":
        return "cycle";
      case "dialog":
        return "open";
      case "action":
        return "confirm";
      case "section":
        return item.collapsed() ? "expand" : "collapse";
      case "branch":
        return "view";
      default:
        return "select";
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────
  useKeyboard(e => {
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
    scrollElementIntoView(sb, el);
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

  // ── Item renderers ─────────────────────────────────────────────────
  // Each function renders one SettingItem kind, closing over component-level
  // reactive state (t, selectedItemIndex, itemRefs, etc.).

  const renderHeader = (item: Extract<SettingItem, { kind: "header" }>, idx: number) => (
    <box
      ref={(el: Renderable) => {
        itemRefs[idx] = el;
      }}
      flexDirection="column"
      width="100%"
      paddingX={4}
    >
      {idx > 0 ? <box height={1} /> : null}
      <text wrapMode="none" fg={t().accent}>
        <strong>
          <span fg={t().accent}>{item.label}</span>
        </strong>
      </text>
    </box>
  );

  const renderInfo = (item: Extract<SettingItem, { kind: "info" }>, idx: number) => (
    <box
      ref={(el: Renderable) => {
        itemRefs[idx] = el;
      }}
      flexDirection="row"
      width="100%"
      paddingX={4}
    >
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
        {item.label.padEnd(INFO_LABEL_WIDTH)}
      </text>
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
        {item.get()}
      </text>
    </box>
  );

  const renderBadge = (item: Extract<SettingItem, { kind: "badge" }>, idx: number) => {
    const bgColor = () => (item.dimmed ? t().backgroundElement : getColorForColumn(item.colorIndex, t().graphColors));
    const fgColor = () => (item.dimmed ? t().foregroundMuted : t().background);
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
      >
        <text bg={bgColor()} fg={fgColor()} wrapMode="none">
          {` ${item.name} `}
        </text>
      </box>
    );
  };

  const renderCopyable = (item: Extract<SettingItem, { kind: "copyable" }>, idx: number) => {
    const isSel = () => selectedItemIndex() === idx;
    const isCopied = () => copiedLabel() === item.label;
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
        backgroundColor={isSel() ? t().backgroundElement : undefined}
      >
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={isSel() ? t().accent : t().foreground}>
          {copyableBannerText(item.get(), isSel())}
        </text>
        {isCopied() ? (
          <text flexShrink={0} wrapMode="none" bg={t().primary} fg={t().background}>
            {" \u2713 copied "}
          </text>
        ) : null}
      </box>
    );
  };

  const renderSection = (item: Extract<SettingItem, { kind: "section" }>, idx: number) => {
    const isSel = () => selectedItemIndex() === idx;
    const indicator = () => (item.collapsed() ? "▸" : "▾");
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="column"
        width="100%"
        paddingX={4}
      >
        {idx > 0 ? <box height={1} /> : null}
        <box flexDirection="row" width="100%" backgroundColor={isSel() ? t().backgroundElement : undefined}>
          <text flexShrink={0} wrapMode="none" fg={t().accent}>
            <strong>
              <span fg={t().accent}>{`${indicator()} ${item.label}`}</span>
            </strong>
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` (${item.count})`}
          </text>
        </box>
      </box>
    );
  };

  const renderBranch = (item: Extract<SettingItem, { kind: "branch" }>, idx: number) => {
    const isSel = () => selectedItemIndex() === idx;
    const hasTracking = () => item.upstream != null;
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingLeft={6}
        paddingRight={4}
        backgroundColor={isSel() ? t().backgroundElement : undefined}
      >
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={isSel() ? t().accent : t().foreground}>
          {item.name}
        </text>
        {hasTracking() ? (
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {"  "}
            {`↑${item.ahead ?? 0}`.padStart(branchTrackWidths().addColWidth)}{" "}
            {`↓${item.behind ?? 0}`.padStart(branchTrackWidths().delColWidth)}
          </text>
        ) : null}
      </box>
    );
  };

  const renderSettingRow = (
    item: Extract<SettingItem, { kind: "toggle" | "cycle" | "dialog" | "action" }>,
    idx: number,
  ) => {
    const isDisabledAction = () => item.kind === "action" && !!item.disabled?.();
    const isSelected = () => !isDisabledAction() && selectedItemIndex() === idx;
    const val = () => valueDisplay(item);

    const paddedVal = () => {
      if (isDisabledAction()) return "";
      const v = val();
      if (!v) return " ".padStart(22);
      if (item.kind === "dialog" || item.kind === "action") return v.padStart(22);
      return `[${v}]`.padStart(22);
    };
    const paddedHotkey = () => {
      if (isDisabledAction()) return "";
      const h =
        item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "action"
          ? (item.hotkey ?? "")
          : "";
      return h.padStart(9);
    };

    const labelColor = () => (isDisabledAction() ? t().foregroundMuted : isSelected() ? t().accent : t().foreground);

    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
        backgroundColor={isSelected() ? t().backgroundElement : undefined}
      >
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={labelColor()}>
          {item.label}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>
          {paddedVal()}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {paddedHotkey()}
        </text>
      </box>
    );
  };

  const renderItem = (item: SettingItem, itemIndex: () => number): JSX.Element => {
    const idx = itemIndex();
    if (item.kind === "header") return renderHeader(item, idx);
    if (item.kind === "info") return renderInfo(item, idx);
    if (item.kind === "badge") return renderBadge(item, idx);
    if (item.kind === "copyable") return renderCopyable(item, idx);
    if (item.kind === "section") return renderSection(item, idx);
    if (item.kind === "branch") return renderBranch(item, idx);
    return renderSettingRow(item, idx);
  };

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
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
            <text flexShrink={0} wrapMode="none" fg={activeTab() === "repository" ? t().accent : t().foregroundMuted}>
              <strong>{"Repository"}</strong>
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
            <text flexShrink={0} wrapMode="none" fg={activeTab() === "branch" ? t().accent : t().foregroundMuted}>
              <strong>{"Branches"}</strong>
            </text>
          </box>
        </box>
        {/* Muted separator below tabs */}
        <box width="100%" paddingX={4} flexShrink={0}>
          <box flexGrow={1} border={["top"]} borderStyle="single" borderColor={t().border} />
        </box>

        {/* Items list */}
        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column">
            <For each={activeItems()}>{(item, itemIndex) => renderItem(item, itemIndex)}</For>
          </box>
        </scrollbox>

        {/* Context-aware footer */}
        <DialogFooter>
          <KeyHint key="enter" desc={` ${footerVerb()}  `} />
          <KeyHint key="←/→" desc=" switch tab  " />
          <KeyHint key="↑/↓" desc=" navigate" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
