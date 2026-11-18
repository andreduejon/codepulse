import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal } from "solid-js";
import { type DashboardSettings, DEFAULT_DASHBOARD_SETTINGS } from "../../core/dashboard-settings";
import type { ProviderDetailView, ProviderView } from "../../core/provider-model";
import type { CodepulseConfig, ConfigInfo, ProviderSection } from "../../core/settings/config";
import { DEFAULT_AUTO_FETCH_INTERVAL, DEFAULT_AUTO_REFRESH_INTERVAL } from "../../core/settings/config";
import type { RepoSettings } from "../app/repo-settings";
import { AUTO_REFRESH_MS, INTERVAL_OPTIONS, MAX_COUNT_OPTIONS, MS_TO_LABEL } from "../constants";
import { useProviderModules } from "../context/provider-modules";
import { useSettings } from "../context/settings";
import { useAppState } from "../context/state";
import { useSystem } from "../context/system";
import type { Theme } from "../context/theme";
import { buildDashboardItems } from "./menu-dashboard-items";
import { COPYABLE_VISIBLE_WIDTH, type MenuTab, type SettingItem } from "./menu-items-types";

/** `5s ago`, `3h ago`; a time the clock puts ahead of now (a clock that is off) is `just now`. */
export const relativeAgeLabel = (time: Date): string => {
  const secs = Math.round((Date.now() - time.getTime()) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

export const REPO_METADATA_MAX_LENGTH = 64;

export function isOptionalRepoMetadataValid(value: string): boolean {
  return value.trim().length <= REPO_METADATA_MAX_LENGTH;
}

export function optionalRepoMetadataValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface MenuItemsOptions {
  /** Currently active tab. */
  activeTab: Accessor<MenuTab>;
  /** Theme name accessor (e.g. "catppuccin-mocha"). */
  themeName: Accessor<string>;
  themes: Record<string, Theme>;
  /** Set the active theme by name. */
  setTheme: (name: string) => void;
  /** Clipboard copy callback. */
  copyToClipboard: (text: string, id: string) => void;
  /** Prop callbacks forwarded from the component. */
  onFetch: () => void;
  /** ctrl+f: fetch, then fast-forward the branches that are only behind. */
  onPull?: () => void;
  onReload: () => void;
  onOpenDialog?: (dialogId: "theme") => void;
  onViewBranch: (branch: string | null) => void;
  onClose: () => void;
  configInfo?: ConfigInfo;
  /** Open the project selector to switch repos. */
  onSwitchRepo?: () => void;
  onOpenCache?: () => void;
  /** Each provider's settings: its rows read and change them. */
  providerSettings?: Accessor<RepoSettings | undefined>;
  dashboardConfig?: Accessor<DashboardSettings | undefined>;
  onDashboardConfigChange?: (cfg: DashboardSettings) => void;
  startView?: Accessor<ProviderView | undefined>;
  onStartViewChange?: (view: ProviderView) => void;
  autoFastForward?: Accessor<boolean | undefined>;
  onAutoFastForwardChange?: (enabled: boolean) => void;
  onRepoDisplayConfigChange?: (cfg: { group?: string; appName?: string }) => void;
}

/** Which view the repository opens in. It offers the views that are turned on; a view turned off since starts in Git. */
export function startViewItem(
  views: readonly ProviderView[],
  current: ProviderView,
  save: (view: ProviderView) => void,
  displayName: (view: ProviderView) => string,
): SettingItem {
  return {
    kind: "cycle",
    label: "Start in",
    options: views.map(displayName),
    get: () => displayName(views.includes(current) ? current : "git"),
    set: value => {
      const view = views.find(option => displayName(option) === value);
      if (view) save(view);
    },
  };
}

export interface MenuItemsResult {
  activeItems: Accessor<SettingItem[]>;
  selectedItemIndex: Accessor<number | undefined>;
  branchTrackWidths: Accessor<{ addColWidth: number; delColWidth: number }>;
  /** Overflow chars for the currently-selected copyable item (for banner scroll). */
  bannerOverflow: Accessor<number>;
  moveCursor: (delta: number) => void;
  selectItem: (itemIndex: number) => boolean;
  activateItem: () => void;
  valueDisplay: (item: SettingItem) => string;
  footerVerb: () => string;
}

/**
 * Owns all data, logic, and cursor state for the MenuDialog.
 * The dialog keeps tab state, scroll refs and token editing; rows render from menu-rows.tsx and provider rows
 * come from each provider's module (providers/<provider>/menu-items.ts).
 */
export function useMenuItems(opts: MenuItemsOptions): MenuItemsResult {
  /** The browser and the environment, through the app's system port. */
  const system = useSystem();
  /** Where the settings are kept: the menu reads and writes them there. */
  const savedSettings = useSettings();
  const { state, actions } = useAppState();
  /** Each provider's module: its rows in the Providers tab. */
  const providerModules = useProviderModules();
  const [repoDisplayConfig, setRepoDisplayConfig] = createSignal(savedSettings.display(state.repoPath()));

  createEffect(() => {
    setRepoDisplayConfig(savedSettings.display(state.repoPath()));
  });

  /**
   * Persist all current settings to the config file immediately.
   * Called after every individual setting change so no manual "Save" is needed.
   */
  const persistFullConfig = (overrides?: Partial<CodepulseConfig>) => {
    const cfg: CodepulseConfig = {
      theme: opts.themeName(),
      pageSize: state.maxCount(),
      showAllBranches: state.showAllBranches(),
      autoRefreshSeconds: state.autoRefreshInterval() / 1000,
      autoFetchSeconds: state.autoFetchInterval() / 1000,
      ...overrides,
    };
    // Every provider's settings too, unless the change is one provider's own.
    const repoSettings = opts.providerSettings?.();
    if (!overrides?.providers && repoSettings)
      cfg.providers = Object.fromEntries(
        state.providers.set.definitions.map(definition => [
          definition.key,
          repoSettings.of(definition)() as ProviderSection,
        ]),
      );
    savedSettings.write(cfg, state.repoPath());
    if (overrides && (Object.hasOwn(overrides, "group") || Object.hasOwn(overrides, "appName"))) {
      const nextRepoDisplayConfig = {
        group: Object.hasOwn(overrides, "group") ? overrides.group : repoDisplayConfig().group,
        appName: Object.hasOwn(overrides, "appName") ? overrides.appName : repoDisplayConfig().appName,
      };
      setRepoDisplayConfig(nextRepoDisplayConfig);
      opts.onRepoDisplayConfigChange?.(nextRepoDisplayConfig);
    }
  };

  // ── Collapsed state for branch sections ───────────────────────────
  const [localCollapsed, setLocalCollapsed] = createSignal(false);
  const [remoteCollapsed, setRemoteCollapsed] = createSignal(false);

  // ── Repository tab items ──────────────────────────────────────────
  const lastFetchLabel = (): string => {
    // Paging in more history also sets `fetching`; only a remote fetch (`f`) counts here.
    if (state.fetching() && !state.fetchingHistory()) return "fetching...";
    const time = state.lastFetchTime();
    if (!time) return "never";
    return relativeAgeLabel(time);
  };

  const providerRefreshLabel = (view: ProviderDetailView): string => {
    const time = state.providerLastSuccessfulRefresh().get(view);
    return time ? relativeAgeLabel(time) : "never";
  };

  const repoItems = createMemo<SettingItem[]>(() => {
    // Start in offers the views turned on: read again when a provider is turned on or off.
    state.providers.getVersion();
    const items: SettingItem[] = [
      { kind: "header", label: "Origin" },
      { kind: "copyable", label: "URL", get: () => state.remoteUrl() || "(none)" },

      { kind: "header", label: "Path" },
      { kind: "copyable", label: "Directory", get: () => state.repoPath() || "(unknown)" },

      { kind: "header", label: "Labels" },
      {
        kind: "editable",
        label: "Group",
        placeholder: "Enter group...",
        get: () => repoDisplayConfig().group ?? "",
        set: v => persistFullConfig({ group: optionalRepoMetadataValue(v) }),
        isDraftValid: isOptionalRepoMetadataValid,
        showValidity: false,
        staySelectedOnSave: true,
      },
      {
        kind: "editable",
        label: "App name",
        placeholder: "Enter name...",
        get: () => repoDisplayConfig().appName ?? "",
        set: v => persistFullConfig({ appName: optionalRepoMetadataValue(v) }),
        isDraftValid: isOptionalRepoMetadataValid,
        showValidity: false,
        staySelectedOnSave: true,
      },

      { kind: "header", label: "Actions" },
      { kind: "action", label: "Fetch remote", hotkey: "f", get: lastFetchLabel, run: () => opts.onFetch() },
      ...(opts.onPull
        ? [{ kind: "action" as const, label: "Fast-forward", hotkey: "ctrl+f", run: () => opts.onPull?.() }]
        : []),
      ...(opts.onSwitchRepo
        ? [{ kind: "action" as const, label: "Switch repository", run: () => opts.onSwitchRepo?.() }]
        : []),
      ...(opts.onOpenCache
        ? [{ kind: "action" as const, label: "Inspect cache", run: () => opts.onOpenCache?.() }]
        : []),

      { kind: "header", label: "Preferences" },
      {
        kind: "dialog",
        label: "Color theme",
        dialogId: "theme",
        get: () => opts.themes[opts.themeName()]?.name ?? opts.themeName(),
      },
      startViewItem(
        state.providers.getEnabledViews(),
        opts.startView?.() ?? "git",
        view => {
          opts.onStartViewChange?.(view);
          persistFullConfig({ startView: view });
        },
        state.providers.set.displayName,
      ),
      {
        kind: "cycle",
        label: "Page size",
        options: MAX_COUNT_OPTIONS.map(String),
        get: () => String(state.maxCount()),
        set: v => {
          actions.setMaxCount(Number.parseInt(v, 10));
          persistFullConfig({ pageSize: Number.parseInt(v, 10) });
        },
        needsReload: true,
      },
      {
        kind: "toggle",
        label: "Show all branches",
        get: () => state.showAllBranches(),
        set: v => {
          actions.setShowAllBranches(v);
          persistFullConfig({ showAllBranches: v });
        },
        needsReload: true,
      },
      {
        kind: "cycle",
        label: "Auto refresh",
        options: INTERVAL_OPTIONS,
        get: () => MS_TO_LABEL[state.autoRefreshInterval()] ?? "off",
        set: v => {
          const ms = AUTO_REFRESH_MS[v] ?? DEFAULT_AUTO_REFRESH_INTERVAL;
          actions.setAutoRefreshInterval(ms);
          persistFullConfig({ autoRefreshSeconds: ms / 1000 });
        },
      },
      {
        kind: "cycle",
        label: "Auto fetch",
        options: INTERVAL_OPTIONS,
        get: () => MS_TO_LABEL[state.autoFetchInterval()] ?? "off",
        set: v => {
          const ms = AUTO_REFRESH_MS[v] ?? DEFAULT_AUTO_FETCH_INTERVAL;
          actions.setAutoFetchInterval(ms);
          persistFullConfig({ autoFetchSeconds: ms / 1000 });
        },
      },
      {
        kind: "toggle",
        label: "Auto fast-forward",
        get: () => opts.autoFastForward?.() ?? false,
        set: v => {
          opts.onAutoFastForwardChange?.(v);
          persistFullConfig({ autoFastForward: v });
        },
      },
    ];

    // ── Configuration section (only when configInfo is available) ──
    const ci = opts.configInfo;
    if (ci) {
      items.push({ kind: "header", label: "Configuration" });
      items.push({
        kind: "copyable",
        label: "Config file",
        get: () => ci.globalPath,
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
    // Without an explicit view, the log follows Show all branches: off means the current branch only.
    const shown = viewing ?? (state.showAllBranches() ? null : state.currentBranch() || null);
    if (shown) {
      result.push({
        kind: "badge",
        name: shown,
        colorIndex: branchColorIndex(shown),
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

  // ── Provider tab items ────────────────────────────────────────────
  const providerItems = createMemo<SettingItem[]>(() => {
    const repoSettings = opts.providerSettings?.();
    const tokenIsSet = (envVar: string) => system.tokenSource(envVar) === "env";
    const dashboard = buildDashboardItems(opts.dashboardConfig?.() ?? DEFAULT_DASHBOARD_SETTINGS, next => {
      opts.onDashboardConfigChange?.(next);
      persistFullConfig({ dashboard: next });
    });
    if (!repoSettings) return dashboard;
    // Each provider's own section, in the providers' order.
    return [
      ...dashboard,
      ...providerModules.flatMap(module => {
        const definition = module.definition;
        return module.menuItems({
          settings: repoSettings.of(definition)(),
          update: next => {
            repoSettings.set(definition, next);
            persistFullConfig({ providers: { [definition.key]: next as ProviderSection } });
          },
          lastRefresh: () => providerRefreshLabel(definition.id),
          tokenIsSet,
          state,
        });
      }),
    ];
  });

  // ── Active items depend on tab ────────────────────────────────────
  const activeItems = createMemo<SettingItem[]>(() => {
    const tab = opts.activeTab();
    if (tab === "repository") return repoItems();
    if (tab === "branch") return branchItems();
    return providerItems();
  });

  // ── Cursor per tab ────────────────────────────────────────────────
  const [repoCursor, setRepoCursor] = createSignal(0);
  const [branchCursor, setBranchCursor] = createSignal(0);
  const [providersCursor, setProvidersCursor] = createSignal(0);

  const currentCursor = () => {
    const tab = opts.activeTab();
    if (tab === "repository") return repoCursor();
    if (tab === "branch") return branchCursor();
    return providersCursor();
  };
  const setCurrentCursor = (v: number | ((prev: number) => number)) => {
    const tab = opts.activeTab();
    const setter = tab === "repository" ? setRepoCursor : tab === "branch" ? setBranchCursor : setProvidersCursor;
    if (typeof v === "function") setter(v);
    else setter(v);
  };

  const selectableIndices = (): number[] =>
    activeItems()
      .map((item, i) =>
        (item.kind === "toggle" && !item.disabled?.()) ||
        item.kind === "cycle" ||
        item.kind === "dialog" ||
        item.kind === "branch" ||
        item.kind === "section" ||
        item.kind === "copyable" ||
        item.kind === "editable" ||
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
    if (item?.kind !== "copyable") return 0;
    return Math.max(0, item.get().length - COPYABLE_VISIBLE_WIDTH);
  });

  const moveCursor = (delta: number) => {
    const indices = selectableIndices();
    const len = indices.length;
    setCurrentCursor((c: number) => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const selectItem = (itemIndex: number): boolean => {
    const cursor = selectableIndices().indexOf(itemIndex);
    if (cursor < 0) return false;
    setCurrentCursor(cursor);
    return true;
  };

  const activateItemAt = (itemIdx: number) => {
    const items = activeItems();
    const item = items[itemIdx];
    if (!item || item.kind === "header" || item.kind === "info" || item.kind === "badge") return;
    if ((item.kind === "action" || item.kind === "toggle") && item.disabled?.()) return;

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
    if (item.kind === "editable") return item.get();
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
      case "editable":
        return "edit";
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
    selectItem,
    activateItem,
    valueDisplay,
    footerVerb,
  };
}
