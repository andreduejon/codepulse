import { MouseButton, type MouseEvent, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createSignal, For, onCleanup } from "solid-js";
import type { ConfigInfo } from "../../config";
import { SHIFT_JUMP } from "../../constants";
import { useAppState } from "../../context/state";
import { useTheme } from "../../context/theme";
import {
  COPYABLE_VISIBLE_WIDTH,
  type GitHubMenuConfig,
  type JenkinsMenuConfig,
  type OpenShiftMenuConfig,
  type SettingItem,
  type SnykMenuConfig,
} from "../../hooks/menu-items-types";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { useMenuItems } from "../../hooks/use-menu-items";
import { scrollIndexedItemIntoView } from "../../utils/scroll";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { type MenuKeyAction, routeMenuKey } from "./menu-keymap";
import { MenuRow, type MenuRowsView } from "./menu-rows";

type MenuTab = "repository" | "branch" | "providers";

interface MenuDialogProps {
  onClose: () => void;
  onReload: () => void;
  onFetch: () => void;
  onOpenDialog?: (dialogId: "theme") => void;
  /** View graph from a specific branch's perspective. null clears the filter. */
  onViewBranch: (branch: string | null) => void;
  /** Config file info from startup, used by the Configuration section. */
  configInfo?: ConfigInfo;
  /** Open the project selector to switch repos. */
  onSwitchRepo?: () => void;
  onOpenCache?: () => void;
  /** Current GitHub provider config (passed through to Providers tab). */
  githubConfig?: GitHubMenuConfig;
  /** Callback to update GitHub provider config. */
  onGithubConfigChange?: (cfg: GitHubMenuConfig) => void;
  jenkinsConfig?: JenkinsMenuConfig;
  onJenkinsConfigChange?: (cfg: JenkinsMenuConfig) => void;
  openshiftConfig?: OpenShiftMenuConfig;
  onOpenShiftConfigChange?: (cfg: OpenShiftMenuConfig) => void;
  snykConfig?: SnykMenuConfig;
  onSnykConfigChange?: (cfg: SnykMenuConfig) => void;
  onRepoDisplayConfigChange?: (cfg: { group?: string; appName?: string }) => void;
}

/** Persists the last-used tab across dialog open/close cycles. */
export const [lastMenuTab, setLastMenuTab] = createSignal<MenuTab>("repository");

export default function MenuDialog(props: Readonly<MenuDialogProps>) {
  const renderer = useRenderer();
  const { actions } = useAppState();
  const { theme, themeName, setTheme, themes } = useTheme();
  const t = () => theme();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.7), dimensions().height - 8);
  const tabBarInnerWidth = () => dialogWidth() - 2 - 8;
  const tabWidth = (idx: number) => {
    const base = Math.floor(tabBarInnerWidth() / 3);
    const remainder = tabBarInnerWidth() % 3;
    return base + (idx < remainder ? 1 : 0);
  };

  // ── Tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = createSignal<MenuTab>(lastMenuTab());
  const [hoveredTab, setHoveredTab] = createSignal<MenuTab | null>(null);
  const [hoveredItem, setHoveredItem] = createSignal<SettingItem | null>(null);
  createEffect(() => {
    setLastMenuTab(activeTab());
  });

  // ── Clipboard feedback ────────────────────────────────────────────
  const { copiedId: copiedLabel, copyToClipboard } = useClipboard();

  // ── Menu items hook ───────────────────────────────────────────────
  const {
    activeItems,
    selectedItemIndex,
    branchTrackWidths,
    bannerOverflow,
    moveCursor,
    selectItem,
    activateItem,
    valueDisplay,
    footerVerb,
  } = useMenuItems({
    activeTab,
    themeName,
    themes,
    setTheme,
    copyToClipboard,
    onFetch: () => props.onFetch(),
    onReload: () => props.onReload(),
    onOpenDialog: props.onOpenDialog,
    onViewBranch: branch => props.onViewBranch(branch),
    onClose: () => props.onClose(),
    configInfo: props.configInfo,
    onSwitchRepo: props.onSwitchRepo,
    onOpenCache: props.onOpenCache,
    githubConfig: () => props.githubConfig,
    onGithubConfigChange: props.onGithubConfigChange,
    jenkinsConfig: () => props.jenkinsConfig,
    onJenkinsConfigChange: props.onJenkinsConfigChange,
    openshiftConfig: () => props.openshiftConfig,
    onOpenShiftConfigChange: props.onOpenShiftConfigChange,
    snykConfig: () => props.snykConfig,
    onSnykConfigChange: props.onSnykConfigChange,
    onRepoDisplayConfigChange: props.onRepoDisplayConfigChange,
  });

  // ── Banner scroll for selected copyable rows ──────────────────────
  /** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
  const bannerOffset = useBannerScroll(bannerOverflow);

  /** Returns the visible slice of a copyable value, applying banner offset when selected. */
  const copyableBannerText = (text: string, isSelected: boolean, width = COPYABLE_VISIBLE_WIDTH): string => {
    if (text.length <= width) return text;
    if (!isSelected) return text; // let the TUI truncate when not selected
    const off = bannerOffset();
    return text.substring(off, off + width);
  };

  const forgetSelected = (): boolean => {
    const idx = selectedItemIndex();
    if (idx == null) return false;
    const item = activeItems()[idx];
    if (item?.kind !== "copyable" || !item.onForget) return false;
    item.onForget();
    moveCursor(0);
    return true;
  };
  /** Run the action row that shows `key` in its hotkey column (`f` Fetch remote), when the tab has one. */
  const runHotkey = (key: string) => {
    const item = activeItems().find(entry => entry.kind === "action" && entry.hotkey === key);
    if (item?.kind !== "action" || item.disabled?.()) return;
    item.run();
  };

  // ── Token edit mode (native OpenTUI input only while explicitly editing) ──
  const [editingIdx, setEditingIdx] = createSignal<number | null>(null);
  const [editDraft, setEditDraft] = createSignal("");
  const [autoEditSuppressedIdx, setAutoEditSuppressedIdx] = createSignal<number | null>(null);
  const [pendingSelectionLabel, setPendingSelectionLabel] = createSignal<string | null>(null);

  createEffect(() => {
    actions.setKeyboardScopeOverride(editingIdx() == null ? null : "menu-token-edit");
  });

  onCleanup(() => actions.setKeyboardScopeOverride(null));

  const startEdit = () => {
    const idx = selectedItemIndex();
    if (idx == null) return;
    const item = activeItems()[idx];
    if (item?.kind !== "editable") return;
    setAutoEditSuppressedIdx(null);
    setEditingIdx(idx);
    setEditDraft(item.get());
  };

  const saveEdit = (): boolean => {
    const idx = editingIdx();
    if (idx == null) return true;
    const item = activeItems()[idx];
    const draft = editDraft();
    if (item?.kind === "editable" && item.isDraftValid && !item.isDraftValid(draft)) return false;
    batch(() => {
      setEditingIdx(null);
      setEditDraft("");
      if (item?.kind === "editable") item.set(draft);
      if (item?.kind === "editable" && item.staySelectedOnSave) setPendingSelectionLabel(item.label);
    });
    return true;
  };

  const cancelEdit = () => {
    const idx = editingIdx();
    const item = idx == null ? undefined : activeItems()[idx];
    if (item?.kind === "editable" && item.fullWidth) setAutoEditSuppressedIdx(idx);
    setEditingIdx(null);
    setEditDraft("");
  };

  const close = () => (editingIdx() == null ? props.onClose() : cancelEdit());

  const rowMouse = (item: SettingItem, idx: number) => ({
    onMouseOver: () => setHoveredItem(item),
    onMouseOut: () => setHoveredItem(null),
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== MouseButton.LEFT) return;
      event.stopPropagation();
      // Let the native input position its caret without restarting the draft.
      if (editingIdx() === idx) return;
      event.preventDefault();
      batch(() => {
        // Saving a provider draft can rebuild/insert rows before the clicked target.
        const matches = (candidate: SettingItem) =>
          candidate.kind === item.kind &&
          (candidate.kind === "branch" && item.kind === "branch"
            ? candidate.name === item.name
            : "label" in candidate && "label" in item && candidate.label === item.label);
        const occurrence = activeItems().slice(0, idx).filter(matches).length;
        if (!saveEdit()) return;
        setPendingSelectionLabel(null);
        const target = activeItems()
          .map((candidate, index) => (matches(candidate) ? index : -1))
          .filter(index => index >= 0)[occurrence];
        if (!selectItem(target)) return;
        if (item.kind === "editable") startEdit();
        else activateItem();
      });
    },
  });

  createEffect(() => {
    const targetLabel = pendingSelectionLabel();
    if (!targetLabel) return;
    const idx = activeItems().findIndex(item => item.kind === "editable" && item.label === targetLabel);
    if (idx < 0) return;
    setPendingSelectionLabel(null);
    selectItem(idx);
  });

  createEffect(() => {
    const idx = selectedItemIndex();
    if (idx == null) return;
    if (autoEditSuppressedIdx() != null && autoEditSuppressedIdx() !== idx) setAutoEditSuppressedIdx(null);
    if (editingIdx() != null) return;
    if (autoEditSuppressedIdx() === idx) return;
    const item = activeItems()[idx];
    if (item?.kind !== "editable" || !item.fullWidth) return;
    setEditingIdx(idx);
    setEditDraft(item.get());
  });

  // ── Keyboard ──────────────────────────────────────────────────────
  const TAB_ORDER: MenuTab[] = ["repository", "branch", "providers"];
  const runMenuAction = (action: MenuKeyAction, shift?: boolean) => {
    switch (action) {
      case "close":
        props.onClose();
        break;
      case "move-down":
        if (editingIdx() != null) saveEdit();
        moveCursor(shift ? SHIFT_JUMP : 1);
        break;
      case "move-up":
        if (editingIdx() != null) saveEdit();
        moveCursor(shift ? -SHIFT_JUMP : -1);
        break;
      case "activate":
        activateItem();
        break;
      case "forget":
        // `f` forgets a removable row; anywhere else it is the Fetch remote hotkey the menu shows.
        if (!forgetSelected()) runHotkey("f");
        break;
      case "start-edit":
        startEdit();
        break;
      case "save-edit":
        saveEdit();
        break;
      case "cancel-edit":
        cancelEdit();
        break;
      case "prev-tab": {
        const idx = TAB_ORDER.indexOf(activeTab());
        if (idx > 0) setActiveTab(TAB_ORDER[idx - 1]);
        break;
      }
      case "next-tab": {
        const idx = TAB_ORDER.indexOf(activeTab());
        if (idx < TAB_ORDER.length - 1) setActiveTab(TAB_ORDER[idx + 1]);
        break;
      }
      default:
    }
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;

    const idx = selectedItemIndex();
    const selected = idx == null ? undefined : activeItems()[idx];
    const editingFullWidth = editingIdx() != null && selected?.kind === "editable" && !!selected.fullWidth;

    if (editingFullWidth) {
      if (e.name === "escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
        return;
      }
      if (e.name === "up" || e.name === "down") {
        e.preventDefault();
        e.stopPropagation();
        saveEdit();
        moveCursor(e.name === "up" ? -1 : 1);
        return;
      }
    }

    // Quit, unless a field is being edited: there `q` is typed like any other letter.
    if (e.name === "q" && editingIdx() == null) {
      e.preventDefault();
      e.stopPropagation();
      renderer.destroy();
      return;
    }

    if (idx == null) return;
    const decision = routeMenuKey({
      mode: editingIdx() == null ? "normal" : "token-edit",
      keyName: e.name,
      shift: e.shift,
      selectedKind: selected?.kind === "editable" ? "editable" : selected ? "other" : null,
    });

    if (decision.consume) {
      e.preventDefault();
      e.stopPropagation();
      runMenuAction(decision.action, e.shift);
    }
  });

  // ── Scrollbox ref and auto-scroll into view ──────────────────────
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const itemRefs = new Map<SettingItem, Renderable>();

  createEffect(() => {
    const items = activeItems();
    const index = selectedItemIndex();
    const item = index == null ? undefined : items[index];
    const ref = item ? itemRefs.get(item) : undefined;
    if (scrollboxRef && ref) scrollIndexedItemIntoView(scrollboxRef, [ref], 0);
  });

  // ── Rows ──────────────────────────────────────────────────────────
  const rowsView: MenuRowsView = {
    t,
    selectedIndex: selectedItemIndex,
    hoveredItem,
    rowMouse,
    itemRef: item => el => {
      itemRefs.set(item, el);
    },
    copiedLabel,
    copyableText: copyableBannerText,
    branchTrackWidths,
    valueDisplay,
    editingIdx,
    editDraft,
    setEditDraft,
  };

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Menu" onClose={close} />

        {/* Tab bar with top accent line per selected tab, muted bottom separator */}
        <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
          <For each={TAB_ORDER}>
            {(tab, idx) => {
              const selected = () => activeTab() === tab;
              const lineColor = () => (selected() ? t().accent : hoveredTab() === tab ? t().foreground : t().border);
              const textColor = () =>
                selected() ? t().accent : hoveredTab() === tab ? t().foreground : t().foregroundMuted;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: TUI tabs also support Left/Right.
                // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected tab already uses accent colors.
                <box
                  width={tabWidth(idx())}
                  flexShrink={0}
                  flexGrow={1}
                  flexDirection="column"
                  onMouseOver={() => setHoveredTab(tab)}
                  onMouseOut={() => setHoveredTab(null)}
                  onMouseDown={event => {
                    if (event.button !== MouseButton.LEFT) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (activeTab() === tab) return;
                    batch(() => {
                      if (!saveEdit()) return;
                      setPendingSelectionLabel(null);
                      setHoveredItem(null);
                      setActiveTab(tab);
                    });
                  }}
                >
                  <box border={["top"]} borderStyle="single" borderColor={lineColor()} flexShrink={0} />
                  <box flexDirection="row" justifyContent="center" flexShrink={0}>
                    <text flexShrink={0} wrapMode="none" fg={textColor()}>
                      <strong>
                        {tab === "repository" ? "Repository" : tab === "branch" ? "Branches" : "Providers"}
                      </strong>
                    </text>
                  </box>
                  <box border={["top"]} borderStyle="single" borderColor={t().border} flexShrink={0} />
                </box>
              );
            }}
          </For>
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
            <For each={activeItems()}>
              {(item, itemIndex) => {
                // The index is read once per row, as the rows were rendered before.
                const index = itemIndex();
                return <MenuRow view={rowsView} item={item} index={index} />;
              }}
            </For>
          </box>
        </scrollbox>

        {/* Context-aware footer */}
        <DialogFooter>
          {editingIdx() == null ? (
            <>
              <KeyHint
                key="enter"
                desc={` ${footerVerb()}`}
                onClick={() => {
                  const idx = selectedItemIndex();
                  if (idx == null) return;
                  runMenuAction(activeItems()[idx]?.kind === "editable" ? "start-edit" : "activate");
                }}
              />
              {(() => {
                const idx = selectedItemIndex();
                const item = idx == null ? undefined : activeItems()[idx];
                return item?.kind === "copyable" && item.onForget ? (
                  <>
                    <KeyHintSeparator />
                    <KeyHint key="f" desc=" forget" onClick={forgetSelected} />
                  </>
                ) : null;
              })()}
              <KeyHintSeparator />
              <KeyHint key="←/→" desc=" switch tab" />
              <KeyHintSeparator />
              <KeyHint key="↑/↓" desc=" navigate" />
            </>
          ) : (
            <>
              <KeyHint key="enter" desc=" save" onClick={saveEdit} />
              <KeyHintSeparator />
              <KeyHint key="esc" desc=" cancel" onClick={cancelEdit} />
            </>
          )}
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
