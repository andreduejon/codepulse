import { createSignal, onMount, onCleanup, For, Show, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useAppState, DEFAULT_AUTO_REFRESH_INTERVAL } from "../../context/state";
import { useTheme, themes } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { createBranch, deleteBranch } from "../../git/repo";

export type OperationsTab = "repository" | "branch";

interface OperationsDialogProps {
  onClose: () => void;
  onReload: () => void;
  onOpenDialog?: (dialogId: string) => void;
  /** Which tab to show initially. */
  initialTab?: OperationsTab;
  /** Called when the user switches branches via the Branch tab. */
  onSwitchBranch?: (branch: string) => void;
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

/**
 * Available width for the path banner text.
 * Dialog width=70, paddingX=1 on dialog, paddingX=4 on row → 70 - 2 - 8 = 60 usable.
 * Subtract label column to get the scrollable area.
 */
const PATH_VISIBLE_WIDTH = 60 - INFO_LABEL_WIDTH;

/** Scrolling speed: shift 1 char every N ms. */
const BANNER_TICK_MS = 200;
/** Pause at each end before reversing (ms). */
const BANNER_PAUSE_MS = 2000;

type SettingItem =
  | { kind: "header"; label: string }
  | { kind: "info"; label: string; get: () => string }
  | { kind: "path" }
  | { kind: "toggle"; label: string; hotkey?: string; get: () => boolean; set: (v: boolean) => void; needsReload?: boolean }
  | { kind: "cycle"; label: string; hotkey?: string; options: string[]; get: () => string; set: (v: string) => void; needsReload?: boolean }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: string; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; run: () => void }
  | { kind: "disabled"; label: string };

export default function OperationsDialog(props: Readonly<OperationsDialogProps>) {
  const { state, actions } = useAppState();
  const { theme, themeName } = useTheme();
  const t = () => theme();

  // ── Tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = createSignal<OperationsTab>(props.initialTab ?? "repository");

  // ── Scrolling banner for Path (Repository tab) ────────────────────
  const [pathOffset, setPathOffset] = createSignal(0);
  const [bannerDirection, setBannerDirection] = createSignal<1 | -1>(1);

  let bannerTimer: ReturnType<typeof setInterval> | undefined;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;

  const startBanner = () => {
    bannerTimer = setInterval(() => {
      const path = state.repoPath() || "";
      const maxOffset = Math.max(0, path.length - PATH_VISIBLE_WIDTH);
      if (maxOffset <= 0) return;

      setPathOffset((prev) => {
        const dir = bannerDirection();
        const next = prev + dir;

        if (next >= maxOffset) {
          clearInterval(bannerTimer);
          bannerTimer = undefined;
          pauseTimer = setTimeout(() => {
            setBannerDirection(-1);
            startBanner();
          }, BANNER_PAUSE_MS);
          return maxOffset;
        }
        if (next <= 0) {
          clearInterval(bannerTimer);
          bannerTimer = undefined;
          pauseTimer = setTimeout(() => {
            setBannerDirection(1);
            startBanner();
          }, BANNER_PAUSE_MS);
          return 0;
        }
        return next;
      });
    }, BANNER_TICK_MS);
  };

  onMount(() => {
    pauseTimer = setTimeout(() => startBanner(), BANNER_PAUSE_MS);
  });

  onCleanup(() => {
    if (bannerTimer) clearInterval(bannerTimer);
    if (pauseTimer) clearTimeout(pauseTimer);
  });

  const pathBannerText = (): string => {
    const path = state.repoPath() || "(unknown)";
    if (path.length <= PATH_VISIBLE_WIDTH) return path;
    return path.substring(pathOffset(), pathOffset() + PATH_VISIBLE_WIDTH);
  };

  // ── Status message (for branch operations feedback) ───────────────
  const [statusMsg, setStatusMsg] = createSignal<{ text: string; isError: boolean } | null>(null);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const showStatus = (text: string, isError: boolean) => {
    setStatusMsg({ text, isError });
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatusMsg(null), 3000);
  };
  onCleanup(() => { if (statusTimer) clearTimeout(statusTimer); });

  // ── Repository tab items ──────────────────────────────────────────
  const repoItems: SettingItem[] = [
    { kind: "header", label: "Info" },
    { kind: "info", label: "Origin", get: () => state.remoteUrl() || "(none)" },
    { kind: "info", label: "Branch", get: () => state.currentBranch() || "(unknown)" },
    { kind: "path" },

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
      hotkey: "a",
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

    { kind: "header", label: "Actions" },
    { kind: "action", label: "Reload data", run: () => props.onReload() },

    { kind: "header", label: "Coming Soon" },
    { kind: "disabled", label: "Fetch from remote" },
    { kind: "disabled", label: "Pull" },
    { kind: "disabled", label: "Push" },
    { kind: "disabled", label: "Stash / Unstash" },
    { kind: "disabled", label: "Cherry-pick" },
    { kind: "disabled", label: "Revert commit" },
  ];

  // ── Branch tab items ──────────────────────────────────────────────
  const localBranches = createMemo(() =>
    state.branches().filter((b) => !b.isRemote)
  );

  const branchItems = createMemo<SettingItem[]>(() => {
    const locals = localBranches();
    const totalBranches = state.branches().length;
    const localCount = locals.length;
    const remoteCount = totalBranches - localCount;

    const switchItems: SettingItem[] = locals.map((b) => ({
      kind: "action" as const,
      label: b.isCurrent ? `${b.name}  (current)` : b.name,
      run: () => {
        if (!b.isCurrent) {
          props.onSwitchBranch?.(b.name);
          props.onClose();
        }
      },
    }));

    return [
      { kind: "header", label: "Info" },
      { kind: "info", label: "Current", get: () => state.currentBranch() || "(unknown)" },
      { kind: "info", label: "Local", get: () => String(localCount) },
      { kind: "info", label: "Remote", get: () => String(remoteCount) },

      { kind: "header", label: "Switch Branch" },
      ...switchItems,

      { kind: "header", label: "Actions" },
      {
        kind: "action",
        label: "Create branch",
        run: async () => {
          // For now, create a branch from current HEAD
          // A proper input field would be ideal; using a prompt-style approach
          // We'll use a simple sequential name for demonstration
          const name = `branch-${Date.now()}`;
          const result = await createBranch(state.repoPath(), name);
          if (result.ok) {
            showStatus(`Created and switched to '${name}'`, false);
            props.onReload();
          } else {
            showStatus(result.error ?? "Failed to create branch", true);
          }
        },
      },
      {
        kind: "action",
        label: "Delete branch",
        run: async () => {
          // Delete the branch at current cursor in the switch list
          // For safety, this is a placeholder — needs proper selection UX
          showStatus("Select a non-current branch to delete", true);
        },
      },

      { kind: "header", label: "Coming Soon" },
      { kind: "disabled", label: "Rename branch" },
      { kind: "disabled", label: "Merge branch" },
    ];
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
        item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "action"
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
    if (!item || item.kind === "header" || item.kind === "info" || item.kind === "path" || item.kind === "disabled") return;

    if (item.kind === "toggle") {
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
    }
  };

  const activateItem = () => activateItemAt(selectedItemIndex());

  // Context-aware verb for the footer
  const footerVerb = (): string => {
    const items = activeItems();
    const item = items[selectedItemIndex()];
    if (!item) return "select";
    switch (item.kind) {
      case "toggle": return "toggle";
      case "cycle": return "cycle";
      case "dialog": return "open";
      case "action": return "confirm";
      default: return "select";
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "down":
        moveCursor(1);
        break;
      case "up":
        moveCursor(-1);
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

  // Format the value display for an item
  const valueDisplay = (item: SettingItem): string => {
    if (item.kind === "header" || item.kind === "action" || item.kind === "disabled" || item.kind === "path") return "";
    if (item.kind === "info") return item.get();
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
      <DialogTitleBar title="Operations" />

      {/* Tab bar */}
      <box flexDirection="row" width="100%" paddingX={4}>
        <text
          flexShrink={0}
          wrapMode="none"
          fg={activeTab() === "repository" ? t().accent : t().foregroundMuted}
        >
          <strong>
            <span fg={activeTab() === "repository" ? t().accent : t().foregroundMuted}>
              {"Repository"}
            </span>
          </strong>
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{"    "}</text>
        <text
          flexShrink={0}
          wrapMode="none"
          fg={activeTab() === "branch" ? t().accent : t().foregroundMuted}
        >
          <strong>
            <span fg={activeTab() === "branch" ? t().accent : t().foregroundMuted}>
              {"Branch"}
            </span>
          </strong>
        </text>
      </box>
      <box height={1} />

      {/* Items list */}
      <box flexDirection="column" flexGrow={1}>
        <For each={activeItems()}>
          {(item, itemIndex) => {
            // --- Header ---
            if (item.kind === "header") {
              return (
                <box flexDirection="column" width="100%" paddingX={4}>
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
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {item.label.padEnd(INFO_LABEL_WIDTH)}
                  </text>
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                    {item.get()}
                  </text>
                </box>
              );
            }

            // --- Path banner (scrolling, dimmed) ---
            if (item.kind === "path") {
              return (
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {"Path".padEnd(INFO_LABEL_WIDTH)}
                  </text>
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                    {pathBannerText()}
                  </text>
                </box>
              );
            }

            // --- Disabled (non-selectable, foregroundMuted) ---
            if (item.kind === "disabled") {
              return (
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                    <span fg={t().foregroundMuted}>{item.label}</span>
                  </text>
                  <text flexShrink={0} wrapMode="none">{" ".padStart(22)}</text>
                  <text flexShrink={0} wrapMode="none">{" ".padStart(9)}</text>
                </box>
              );
            }

            // --- Selectable items: toggle, cycle, dialog, action ---
            const isSelected = () => selectedItemIndex() === itemIndex();
            const val = () => valueDisplay(item);

            // Pad value and hotkey to fixed widths for right-alignment
            const paddedVal = () => {
              if (item.kind === "action") return " ".padStart(22);
              const v = item.kind === "dialog" ? val() : `[${val()}]`;
              return v.padStart(22);
            };
            const paddedHotkey = () => {
              const h = (item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog")
                ? (item.hotkey ?? "")
                : "";
              return h.padStart(9);
            };

            return (
              <box
                flexDirection="row"
                width="100%"
                paddingX={4}
                backgroundColor={isSelected() ? t().backgroundElement : undefined}
              >
                {/* Setting name */}
                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                  <span fg={isSelected() ? t().primary : t().foreground}>
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

      {/* Status message */}
      <Show when={statusMsg()}>
        {(msg) => (
          <box flexDirection="row" width="100%" paddingX={4}>
            <text wrapMode="none" fg={msg().isError ? t().error : t().success}>
              {msg().text}
            </text>
          </box>
        )}
      </Show>

      {/* Context-aware footer */}
      <box height={1} />
      <box flexDirection="row" width="100%" paddingX={4}>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>enter</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{` ${footerVerb()}  `}</text>
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>←/→</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" tab  "}</text>
        <text flexShrink={0} wrapMode="none" fg={t().foreground}>↑/↓</text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" navigate"}</text>
      </box>
      </box>
    </DialogOverlay>
  );
}
