import { homedir } from "node:os";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import type { CodepulseConfig, ConfigInfo } from "../config";
import { writeConfig } from "../config";
import { DEFAULT_MAX_COUNT } from "../constants";
import { DEFAULT_AUTO_REFRESH_INTERVAL, useAppState } from "../context/state";
import { themes } from "../context/theme";

type MenuTab = "repository" | "branch";

export type SettingItem =
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
export const INFO_LABEL_WIDTH = 12;

/** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
export const COPYABLE_VISIBLE_WIDTH = 60;

export interface MenuItemsOptions {
  /** Currently active tab. */
  activeTab: Accessor<MenuTab>;
  /** Theme name accessor (e.g. "catppuccin-mocha"). */
  themeName: Accessor<string>;
  /** Set the active theme by name. */
  setTheme: (name: string) => void;
  /** Config scope signal. */
  configScope: Accessor<"global" | "this repo">;
  setConfigScope: (v: "global" | "this repo") => void;
  /** Saved-feedback label signal and trigger. */
  savedFeedback: Accessor<string | null>;
  showSavedFeedback: (label: string) => void;
  /** Clipboard copy callback. */
  copyToClipboard: (text: string, id: string) => void;
  /** Prop callbacks forwarded from the component. */
  onFetch: () => void;
  onReload: () => void;
  onOpenDialog?: (dialogId: string) => void;
  onViewBranch: (branch: string | null) => void;
  onClose: () => void;
  configInfo?: ConfigInfo;
}

export interface MenuItemsResult {
  activeItems: Accessor<SettingItem[]>;
  selectedItemIndex: Accessor<number | undefined>;
  branchTrackWidths: Accessor<{ addColWidth: number; delColWidth: number }>;
  /** Overflow chars for the currently-selected copyable item (for banner scroll). */
  bannerOverflow: Accessor<number>;
  moveCursor: (delta: number) => void;
  activateItem: () => void;
  valueDisplay: (item: SettingItem) => string;
  footerVerb: () => string;
}

/**
 * Owns all data, logic, and cursor state for the MenuDialog.
 * The component retains tab-switching state, scroll refs, and render functions.
 */
export function useMenuItems(opts: MenuItemsOptions): MenuItemsResult {
  const { state, actions } = useAppState();

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
      { kind: "action", label: "Fetch remote", hotkey: "f", get: lastFetchLabel, run: () => opts.onFetch() },

      { kind: "header", label: "Preferences" },
      {
        kind: "dialog",
        label: "Color theme",
        hotkey: "ctrl+t",
        dialogId: "theme",
        get: () => themes[opts.themeName()]?.name ?? opts.themeName(),
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
          opts.setTheme("catppuccin-mocha");
          actions.setMaxCount(DEFAULT_MAX_COUNT);
          actions.setShowAllBranches(true);
          actions.setAutoRefreshInterval(DEFAULT_AUTO_REFRESH_INTERVAL);
          opts.onReload();
        },
      },
    ];

    // ── Configuration section (only when configInfo is available) ──
    const ci = opts.configInfo;
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
        get: () => opts.configScope(),
        set: v => opts.setConfigScope(v as "global" | "this repo"),
      });
      items.push({
        kind: "action",
        label: "Save to config",
        get: () => (opts.savedFeedback() === "Save to config" ? "\u2713 Saved!" : ""),
        run: () => {
          const autoRefreshMs = state.autoRefreshInterval();
          const cfg: CodepulseConfig = {
            theme: opts.themeName(),
            pageSize: state.maxCount(),
            showAllBranches: state.showAllBranches(),
            autoRefreshSeconds: autoRefreshMs / 1000,
          };
          const scope = opts.configScope() === "global" ? ("global" as const) : ("repo" as const);
          const ok = writeConfig(cfg, scope, scope === "repo" ? state.repoPath() : undefined);
          if (ok) {
            ci.globalExists = true;
            if (scope === "repo") ci.hasRepoOverrides = true;
            opts.showSavedFeedback("Save to config");
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
      opts.onViewBranch(b.name);
      opts.onClose();
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
        opts.onViewBranch(null);
        opts.onClose();
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
  const activeItems = createMemo<SettingItem[]>(() =>
    opts.activeTab() === "repository" ? repoItems() : branchItems(),
  );

  // ── Cursor per tab ────────────────────────────────────────────────
  const [repoCursor, setRepoCursor] = createSignal(0);
  const [branchCursor, setBranchCursor] = createSignal(0);

  const currentCursor = () => (opts.activeTab() === "repository" ? repoCursor() : branchCursor());
  const setCurrentCursor = (v: number | ((prev: number) => number)) => {
    const setter = opts.activeTab() === "repository" ? setRepoCursor : setBranchCursor;
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

  const selectedItemIndex = createMemo(() => selectableIndices()[currentCursor()]);

  // Overflow memo for the currently-selected copyable item
  // NOTE: must be placed after selectedItemIndex/activeItems to avoid TDZ with createMemo's eager evaluation
  const bannerOverflow = createMemo(() => {
    const idx = selectedItemIndex();
    const items = activeItems();
    const item = items[idx];
    if (!item || item.kind !== "copyable") return 0;
    return Math.max(0, item.get().length - COPYABLE_VISIBLE_WIDTH);
  });

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
      opts.copyToClipboard(item.get(), item.label);
    } else if (item.kind === "toggle") {
      item.set(!item.get());
      if (item.needsReload) opts.onReload();
    } else if (item.kind === "cycle") {
      const currentVal = item.get();
      const currentIdx = item.options.indexOf(currentVal);
      const nextIdx = (currentIdx + 1) % item.options.length;
      item.set(item.options[nextIdx]);
      if (item.needsReload) opts.onReload();
    } else if (item.kind === "dialog") {
      opts.onOpenDialog?.(item.dialogId);
    } else if (item.kind === "action") {
      item.run();
    } else if (item.kind === "section") {
      item.toggle();
    } else if (item.kind === "branch") {
      item.run();
    }
  };

  const activateItem = () => activateItemAt(selectedItemIndex());

  // Format the value display for an item
  const valueDisplay = (item: SettingItem): string => {
    if (item.kind === "header" || item.kind === "branch" || item.kind === "section" || item.kind === "badge") return "";
    if (item.kind === "action") return item.get ? item.get() : "";
    if (item.kind === "info") return item.get();
    if (item.kind === "copyable") return item.get();
    if (item.kind === "toggle") return item.get() ? "on" : "off";
    return item.get();
  };

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

  return {
    activeItems,
    selectedItemIndex,
    branchTrackWidths,
    bannerOverflow,
    moveCursor,
    activateItem,
    valueDisplay,
    footerVerb,
  };
}
