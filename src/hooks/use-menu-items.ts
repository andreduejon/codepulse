import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { CodepulseConfig, ConfigInfo } from "../config";
import { getRepoDisplayConfig } from "../config";
import { writeConfig } from "../config-write";
import { AUTO_REFRESH_MS, INTERVAL_OPTIONS, MAX_COUNT_OPTIONS, MS_TO_LABEL } from "../constants";
import { DEFAULT_AUTO_FETCH_INTERVAL, DEFAULT_AUTO_REFRESH_INTERVAL, useAppState } from "../context/state";
import type { Theme } from "../context/theme";
import { getTokenSource } from "../providers/github-actions/api";
import type { ProviderDetailView } from "../providers/provider";
import { DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS } from "../providers/shared/auto-refresh";
import {
  COPYABLE_VISIBLE_WIDTH,
  type GitHubMenuConfig,
  type JenkinsMenuConfig,
  type MenuTab,
  type OpenShiftMenuConfig,
  type SettingItem,
  type SnykMenuConfig,
} from "./menu-items-types";
import {
  buildGitHubProviderItems,
  buildJenkinsProviderItems,
  buildOpenShiftProviderItems,
  buildSnykProviderItems,
} from "./menu-provider-items";

const relativeAgeLabel = (time: Date): string => {
  const secs = Math.round((Date.now() - time.getTime()) / 1000);
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
  onReload: () => void;
  onOpenDialog?: (dialogId: "theme") => void;
  onViewBranch: (branch: string | null) => void;
  onClose: () => void;
  configInfo?: ConfigInfo;
  /** Open the project selector to switch repos. */
  onSwitchRepo?: () => void;
  onOpenCache?: () => void;
  /** Current GitHub provider config (tokenEnvVar, enabled, trustedEnterpriseHost). */
  githubConfig?: Accessor<GitHubMenuConfig | undefined>;
  /** Callback to update GitHub provider config. */
  onGithubConfigChange?: (cfg: GitHubMenuConfig) => void;
  jenkinsConfig?: Accessor<JenkinsMenuConfig | undefined>;
  onJenkinsConfigChange?: (cfg: JenkinsMenuConfig) => void;
  openshiftConfig?: Accessor<OpenShiftMenuConfig | undefined>;
  onOpenShiftConfigChange?: (cfg: OpenShiftMenuConfig) => void;
  snykConfig?: Accessor<SnykMenuConfig | undefined>;
  onSnykConfigChange?: (cfg: SnykMenuConfig) => void;
  onRepoDisplayConfigChange?: (cfg: { group?: string; appName?: string }) => void;
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
 * come from menu-provider-items.ts.
 */
export function useMenuItems(opts: MenuItemsOptions): MenuItemsResult {
  const { state, actions } = useAppState();
  const [repoDisplayConfig, setRepoDisplayConfig] = createSignal(getRepoDisplayConfig(state.repoPath()));

  createEffect(() => {
    setRepoDisplayConfig(getRepoDisplayConfig(state.repoPath()));
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
    if (!overrides?.providers && opts.githubConfig?.()) {
      const ghCfg = opts.githubConfig();
      if (!ghCfg) return;
      cfg.providers = {
        github: {
          enabled: ghCfg.enabled,
          tokenEnvVar: ghCfg.tokenEnvVar,
          trustedEnterpriseHost: ghCfg.trustedEnterpriseHost ?? undefined,
          fetchDepth: ghCfg.fetchDepth,
          cacheLimit: ghCfg.cacheLimit,
          autoRefreshSeconds: ghCfg.autoRefreshSeconds,
        },
      };
      const jenkinsCfg = opts.jenkinsConfig?.();
      if (jenkinsCfg) {
        cfg.providers.jenkins = {
          enabled: jenkinsCfg.enabled,
          username: jenkinsCfg.username,
          tokenEnvVar: jenkinsCfg.tokenEnvVar,
          fetchDepth: jenkinsCfg.fetchDepth,
          cacheLimit: jenkinsCfg.cacheLimit,
          autoRefreshSeconds: jenkinsCfg.autoRefreshSeconds,
          jobs: jenkinsCfg.jobs,
        };
      }
    }
    writeConfig(cfg, state.repoPath());
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
    const ghCfg = opts.githubConfig?.() ?? {
      enabled: false,
      tokenEnvVar: "GITHUB_TOKEN",
      trustedEnterpriseHost: null,
      fetchDepth: 20,
      cacheLimit: 20,
      autoRefreshSeconds: DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
    };
    const tokenSource = getTokenSource(ghCfg.tokenEnvVar);
    const jenkinsCfg = opts.jenkinsConfig?.() ?? {
      enabled: false,
      tokenEnvVar: "JENKINS_TOKEN",
      fetchDepth: 20,
      cacheLimit: 20,
      autoRefreshSeconds: DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
      jobs: [],
    };
    const openshiftCfg = opts.openshiftConfig?.() ?? {
      enabled: false,
      serverUrl: "",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: [],
      commitShaAnnotation: "dev/commit-sha",
      cacheLimit: 20,
      fetchDepth: 20,
      autoRefreshSeconds: DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
    };
    const snykCfg = opts.snykConfig?.() ?? {
      enabled: false,
      tokenEnvVar: "SNYK_TOKEN",
      autoScanBranches: [],
      maxCachedScans: 20 as const,
    };
    return [
      ...buildGitHubProviderItems(
        ghCfg,
        state.remoteUrl(),
        tokenSource,
        opts.onGithubConfigChange,
        newCfg =>
          persistFullConfig({
            providers: { github: { ...newCfg, trustedEnterpriseHost: newCfg.trustedEnterpriseHost ?? undefined } },
          }),
        () => providerRefreshLabel("github-actions"),
      ),
      ...buildJenkinsProviderItems(
        jenkinsCfg,
        opts.onJenkinsConfigChange,
        newCfg => persistFullConfig({ providers: { jenkins: newCfg } }),
        () => providerRefreshLabel("jenkins"),
      ),
      ...buildOpenShiftProviderItems(
        openshiftCfg,
        opts.onOpenShiftConfigChange,
        newCfg => persistFullConfig({ providers: { openshift: newCfg } }),
        () => providerRefreshLabel("openshift"),
      ),
      ...buildSnykProviderItems(snykCfg, state.branches, opts.onSnykConfigChange, newCfg =>
        persistFullConfig({ providers: { snyk: newCfg } }),
      ),
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
