import { homedir } from "node:os";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import type { CodepulseConfig, ConfigInfo } from "../config";
import { writeConfig } from "../config";
import { AUTO_REFRESH_MS, INTERVAL_OPTIONS, MAX_COUNT_OPTIONS, MS_TO_LABEL } from "../constants";
import { DEFAULT_AUTO_FETCH_INTERVAL, DEFAULT_AUTO_REFRESH_INTERVAL, useAppState } from "../context/state";
import { themes } from "../context/theme";
import { getTokenSource, parseGitHubRemote } from "../providers/github-actions/api";

type MenuTab = "repository" | "branch" | "providers";

export type SettingItem =
  | { kind: "header"; label: string; tone?: "accent" | "muted" }
  | { kind: "info"; label: string; get: () => string; valid?: () => boolean }
  | { kind: "copyable"; label: string; get: () => string; onForget?: () => void }
  | {
      kind: "toggle";
      label: string;
      hotkey?: string;
      get: () => boolean;
      set: (v: boolean) => void;
      disabled?: () => boolean;
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
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: "theme"; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; get?: () => string; run: () => void; disabled?: () => boolean }
  | { kind: "section"; label: string; count: number; collapsed: () => boolean; toggle: () => void }
  | { kind: "badge"; name: string; colorIndex: number; dimmed?: boolean }
  | { kind: "branch"; name: string; run: () => void; upstream?: string; ahead?: number; behind?: number }
  | {
      kind: "editable";
      label: string;
      placeholder?: string;
      get: () => string;
      set: (v: string) => void;
      valid?: () => boolean;
      showValidity?: boolean;
      isDraftValid?: (v: string) => boolean;
      keepEditingOnSave?: boolean;
      staySelectedOnSave?: boolean;
      fullWidth?: boolean;
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
  /** Current GitHub provider config (tokenEnvVar, enabled, trustedEnterpriseHost). */
  githubConfig?: Accessor<{ enabled: boolean; tokenEnvVar: string; trustedEnterpriseHost: string | null } | undefined>;
  /** Callback to update GitHub provider config. */
  onGithubConfigChange?: (cfg: { enabled: boolean; tokenEnvVar: string; trustedEnterpriseHost: string | null }) => void;
  jenkinsConfig?: Accessor<
    { enabled: boolean; username?: string; tokenEnvVar: string; jobs: { label?: string; url: string }[] } | undefined
  >;
  onJenkinsConfigChange?: (cfg: {
    enabled: boolean;
    username?: string;
    tokenEnvVar: string;
    jobs: { label?: string; url: string }[];
  }) => void;
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

export interface GitHubMenuConfig {
  enabled: boolean;
  tokenEnvVar: string;
  trustedEnterpriseHost: string | null;
}

export interface JenkinsMenuConfig {
  enabled: boolean;
  username?: string;
  tokenEnvVar: string;
  jobs: { label?: string; url: string }[];
}

export function buildGitHubProviderItems(
  ghCfg: GitHubMenuConfig,
  remoteUrl: string,
  tokenSource: "env" | null,
  onChange?: (cfg: GitHubMenuConfig) => void,
  persist?: (cfg: GitHubMenuConfig) => void,
): SettingItem[] {
  const remoteRepo = parseGitHubRemote(remoteUrl);
  const remoteHost = remoteRepo?.hostname ?? null;
  const hostAllowed = remoteHost === "github.com" || (remoteHost != null && ghCfg.trustedEnterpriseHost === remoteHost);

  const items: SettingItem[] = [
    { kind: "header", label: "github" },
    {
      kind: "toggle",
      label: "Enabled",
      get: () => ghCfg.enabled,
      set: v => {
        const newCfg = { ...ghCfg, enabled: v };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
  ];

  if (!ghCfg.enabled) return items;

  items.push(
    {
      kind: "editable",
      label: "Token",
      placeholder: "Enter token...",
      get: () => ghCfg.tokenEnvVar,
      set: (v: string) => {
        const newCfg = { ...ghCfg, tokenEnvVar: v.trim() };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => !!ghCfg.tokenEnvVar.trim() && tokenSource === "env",
    },
    {
      kind: "info",
      label: "Host",
      get: () => remoteHost ?? "not detected",
      valid: () => hostAllowed,
    },
    {
      kind: "toggle",
      label: "Allow host",
      get: () => hostAllowed,
      set: v => {
        const newCfg = { ...ghCfg, trustedEnterpriseHost: v ? remoteHost : null };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      disabled: () => remoteHost == null || remoteHost === "github.com",
    },
  );

  return items;
}

function buildJenkinsProviderItems(
  jenkinsCfg: JenkinsMenuConfig,
  onChange?: (cfg: JenkinsMenuConfig) => void,
  persist?: (cfg: JenkinsMenuConfig) => void,
): SettingItem[] {
  const items: SettingItem[] = [
    { kind: "header", label: "jenkins" },
    {
      kind: "toggle",
      label: "Enabled",
      get: () => jenkinsCfg.enabled,
      set: v => {
        const newCfg = { ...jenkinsCfg, enabled: v };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
  ];

  if (!jenkinsCfg.enabled) return items;

  items.push(
    {
      kind: "editable",
      label: "Username",
      placeholder: "Enter username...",
      get: () => jenkinsCfg.username ?? "",
      set: v => {
        const username = v.trim() || undefined;
        const newCfg = { ...jenkinsCfg, username };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => !!jenkinsCfg.username?.trim(),
    },
    {
      kind: "editable",
      label: "Token",
      placeholder: "Enter token...",
      get: () => jenkinsCfg.tokenEnvVar,
      set: v => {
        const newCfg = { ...jenkinsCfg, tokenEnvVar: v.trim() || "JENKINS_TOKEN" };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => !!jenkinsCfg.tokenEnvVar.trim() && !!process.env[jenkinsCfg.tokenEnvVar],
    },
    {
      kind: "editable",
      label: "New job",
      placeholder: "Enter job URL...",
      get: () => "",
      set: v => {
        const url = v.trim();
        if (!url) return;
        const newCfg = { ...jenkinsCfg, jobs: [...jenkinsCfg.jobs, { url }] };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => jenkinsCfg.jobs.length > 0,
      showValidity: false,
      isDraftValid: v => v.trim().length > 0,
      staySelectedOnSave: true,
    },
  );

  const jobsInput = items.pop();
  if (jobsInput) items.push(jobsInput);
  items.push(
    ...jenkinsCfg.jobs.map((job, idx) => ({
      kind: "copyable" as const,
      label: `Job #${idx + 1} URL`,
      get: () => ` · ${job.url}`,
      onForget: () => {
        const newCfg = { ...jenkinsCfg, jobs: jenkinsCfg.jobs.filter((_, jobIdx) => jobIdx !== idx) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    })),
  );

  return items;
}

/**
 * Owns all data, logic, and cursor state for the MenuDialog.
 * The component retains tab-switching state, scroll refs, and render functions.
 */
export function useMenuItems(opts: MenuItemsOptions): MenuItemsResult {
  const { state, actions } = useAppState();

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
        },
      };
      const jenkinsCfg = opts.jenkinsConfig?.();
      if (jenkinsCfg) {
        cfg.providers.jenkins = {
          enabled: jenkinsCfg.enabled,
          username: jenkinsCfg.username,
          tokenEnvVar: jenkinsCfg.tokenEnvVar,
          jobs: jenkinsCfg.jobs,
        };
      }
    }
    writeConfig(cfg, state.repoPath());
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
      { kind: "action", label: "Fetch remote", hotkey: "f", get: lastFetchLabel, run: () => opts.onFetch() },
      ...(opts.onSwitchRepo
        ? [{ kind: "action" as const, label: "Switch repository", run: () => opts.onSwitchRepo?.() }]
        : []),

      { kind: "header", label: "Preferences" },
      {
        kind: "dialog",
        label: "Color theme",
        dialogId: "theme",
        get: () => themes[opts.themeName()]?.name ?? opts.themeName(),
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
      const shortenHome = (p: string) =>
        p.replace(new RegExp(`^${homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "~");

      items.push({ kind: "header", label: "Configuration" });
      items.push({
        kind: "info",
        label: "Config file",
        get: () => shortenHome(ci.globalPath),
        valid: () => ci.globalExists,
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

  // ── Provider tab items ────────────────────────────────────────────
  const providerItems = createMemo<SettingItem[]>(() => {
    const ghCfg = opts.githubConfig?.() ?? { enabled: false, tokenEnvVar: "GITHUB_TOKEN", trustedEnterpriseHost: null };
    const tokenSource = getTokenSource(ghCfg.tokenEnvVar);
    const jenkinsCfg = opts.jenkinsConfig?.() ?? { enabled: false, tokenEnvVar: "JENKINS_TOKEN", jobs: [] };
    return [
      ...buildGitHubProviderItems(ghCfg, state.remoteUrl(), tokenSource, opts.onGithubConfigChange, newCfg =>
        persistFullConfig({
          providers: { github: { ...newCfg, trustedEnterpriseHost: newCfg.trustedEnterpriseHost ?? undefined } },
        }),
      ),
      ...buildJenkinsProviderItems(jenkinsCfg, opts.onJenkinsConfigChange, newCfg =>
        persistFullConfig({ providers: { jenkins: newCfg } }),
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
    activateItem,
    valueDisplay,
    footerVerb,
  };
}
