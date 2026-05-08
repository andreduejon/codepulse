import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, type JSX, onCleanup } from "solid-js";
import type { ConfigInfo } from "../../config";
import { SHIFT_JUMP } from "../../constants";
import { useAppState } from "../../context/state";
import { useTheme } from "../../context/theme";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { COPYABLE_VISIBLE_WIDTH, type SettingItem, useMenuItems } from "../../hooks/use-menu-items";
import { scrollIndexedItemIntoView } from "../../utils/scroll";
import Badge from "../badge";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { type MenuKeyAction, routeMenuKey } from "./menu-keymap";

type MenuTab = "repository" | "branch" | "providers";

/** Column widths for the menu item value and hotkey display columns. */
const VALUE_COL_WIDTH = 34;
const HOTKEY_COL_WIDTH = 9;

const clipLeft = (value: string, width: number) => (value.length <= width ? value : `…${value.slice(-(width - 1))}`);

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
  /** Current GitHub provider config (passed through to Providers tab). */
  githubConfig?: { enabled: boolean; tokenEnvVar: string; trustedEnterpriseHost: string | null };
  /** Callback to update GitHub provider config. */
  onGithubConfigChange?: (cfg: { enabled: boolean; tokenEnvVar: string; trustedEnterpriseHost: string | null }) => void;
  jenkinsConfig?: {
    enabled: boolean;
    username?: string;
    tokenEnvVar: string;
    graphBuildLimit: 10 | 20 | 50;
    jobs: { label?: string; url: string }[];
  };
  onJenkinsConfigChange?: (cfg: {
    enabled: boolean;
    username?: string;
    tokenEnvVar: string;
    graphBuildLimit: 10 | 20 | 50;
    jobs: { label?: string; url: string }[];
  }) => void;
  onRepoDisplayConfigChange?: (cfg: { group?: string; appName?: string }) => void;
}

/** Persists the last-used tab across dialog open/close cycles. */
export const [lastMenuTab, setLastMenuTab] = createSignal<MenuTab>("repository");

export default function MenuDialog(props: Readonly<MenuDialogProps>) {
  const renderer = useRenderer();
  const { actions } = useAppState();
  const { theme, themeName, setTheme } = useTheme();
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
    activateItem,
    valueDisplay,
    footerVerb,
  } = useMenuItems({
    activeTab,
    themeName,
    setTheme,
    copyToClipboard,
    onFetch: () => props.onFetch(),
    onReload: () => props.onReload(),
    onOpenDialog: props.onOpenDialog,
    onViewBranch: branch => props.onViewBranch(branch),
    onClose: () => props.onClose(),
    configInfo: props.configInfo,
    onSwitchRepo: props.onSwitchRepo,
    githubConfig: () => props.githubConfig,
    onGithubConfigChange: props.onGithubConfigChange,
    jenkinsConfig: () => props.jenkinsConfig,
    onJenkinsConfigChange: props.onJenkinsConfigChange,
    onRepoDisplayConfigChange: props.onRepoDisplayConfigChange,
  });

  // ── Banner scroll for selected copyable rows ──────────────────────
  /** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
  const bannerOffset = useBannerScroll(bannerOverflow);

  /** Returns the visible slice of a copyable value, applying banner offset when selected. */
  const copyableBannerText = (text: string, isSelected: boolean): string => {
    if (text.length <= COPYABLE_VISIBLE_WIDTH) return text;
    if (!isSelected) return text; // let the TUI truncate when not selected
    const off = bannerOffset();
    return text.substring(off, off + COPYABLE_VISIBLE_WIDTH);
  };

  const forgetSelected = () => {
    const idx = selectedItemIndex();
    if (idx == null) return;
    const item = activeItems()[idx];
    if (item?.kind !== "copyable" || !item.onForget) return;
    item.onForget();
    moveCursor(0);
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

  const saveEdit = () => {
    const idx = editingIdx();
    if (idx == null) return;
    const item = activeItems()[idx];
    if (item?.kind === "editable" && item.isDraftValid && !item.isDraftValid(editDraft())) return;
    if (item?.kind === "editable") item.set(editDraft());
    if (item?.kind === "editable" && item.staySelectedOnSave) {
      setPendingSelectionLabel(item.label);
      setEditingIdx(null);
      setEditDraft("");
      return;
    }
    setEditingIdx(null);
    setEditDraft("");
  };

  const cancelEdit = () => {
    const idx = editingIdx();
    const item = idx == null ? undefined : activeItems()[idx];
    if (item?.kind === "editable" && item.fullWidth) setAutoEditSuppressedIdx(idx);
    setEditingIdx(null);
    setEditDraft("");
  };

  createEffect(() => {
    const targetLabel = pendingSelectionLabel();
    if (!targetLabel) return;
    const idx = activeItems().findIndex(item => item.kind === "editable" && item.label === targetLabel);
    if (idx < 0) return;
    setPendingSelectionLabel(null);
    moveCursor(idx - (selectedItemIndex() ?? 0));
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
        forgetSelected();
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

    if (e.name === "q") {
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
  const itemRefs: Renderable[] = [];

  createEffect(() => {
    scrollIndexedItemIntoView(scrollboxRef, itemRefs, selectedItemIndex());
  });

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
      <box flexDirection="row" width="100%">
        <text flexGrow={1} wrapMode="none" fg={item.tone === "muted" ? t().foregroundMuted : t().accent}>
          <strong>
            <span>{item.label}</span>
          </strong>
        </text>
        {item.get ? (
          <>
            <box width={VALUE_COL_WIDTH} flexShrink={0} flexDirection="row" justifyContent="flex-end">
              <text wrapMode="none" truncate fg={t().foregroundMuted}>
                {clipLeft(item.get(), VALUE_COL_WIDTH)}
              </text>
            </box>
            <box width={HOTKEY_COL_WIDTH} flexShrink={0} />
          </>
        ) : null}
      </box>
    </box>
  );

  const renderInfo = (item: Extract<SettingItem, { kind: "info" }>, idx: number) => {
    const hasStatus = () => item.valid != null;
    const isValid = () => item.valid?.() ?? false;
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
      >
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
          {item.label}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {clipLeft(item.get(), VALUE_COL_WIDTH).padStart(VALUE_COL_WIDTH)}
        </text>
        {hasStatus() ? (
          <text flexShrink={0} width={HOTKEY_COL_WIDTH} wrapMode="none" fg={isValid() ? t().success : t().error}>
            {(isValid() ? "✓" : "✕").padStart(HOTKEY_COL_WIDTH)}
          </text>
        ) : (
          <box width={HOTKEY_COL_WIDTH} flexShrink={0} />
        )}
      </box>
    );
  };

  const renderBadge = (item: Extract<SettingItem, { kind: "badge" }>, idx: number) => {
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
      >
        <Badge name={item.name} colorIndex={item.colorIndex} dimmed={item.dimmed} maxLength={30} />
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
              <span>{`${indicator()} ${item.label}`}</span>
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
    const isDisabled = () => (item.kind === "action" || item.kind === "toggle") && !!item.disabled?.();
    const isSelected = () => !isDisabled() && selectedItemIndex() === idx;
    const val = () => valueDisplay(item);

    const paddedVal = () => {
      const v = val();
      if (!v) return " ".padStart(VALUE_COL_WIDTH);
      if (item.kind === "dialog" || item.kind === "action") return v.padStart(VALUE_COL_WIDTH);
      return `[${v}]`.padStart(VALUE_COL_WIDTH);
    };
    const paddedHotkey = () => {
      if (isDisabled()) return " ".repeat(HOTKEY_COL_WIDTH);
      const h =
        item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "action"
          ? (item.hotkey ?? "")
          : "";
      return h.padStart(HOTKEY_COL_WIDTH);
    };

    const labelColor = () => (isDisabled() ? t().foregroundMuted : isSelected() ? t().accent : t().foreground);
    const valueColor = () => (isDisabled() ? t().foregroundMuted : t().foreground);

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
        <text flexShrink={0} wrapMode="none" fg={valueColor()}>
          {paddedVal()}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {paddedHotkey()}
        </text>
      </box>
    );
  };

  const renderEditable = (item: Extract<SettingItem, { kind: "editable" }>, idx: number) => {
    const isSel = () => selectedItemIndex() === idx;
    const isEditing = () => editingIdx() === idx;
    const valid = () => item.valid?.();
    const showValidity = () => item.showValidity ?? true;
    const savedValue = () => item.get().trim();
    const displayValue = () => savedValue() || item.placeholder || "";
    const labelColor = () => (isSel() ? t().accent : t().foreground);
    const displayColor = () => (savedValue() ? (isSel() ? t().accent : t().foreground) : t().foregroundMuted);
    if (item.fullWidth) {
      return (
        <box
          ref={(el: Renderable) => {
            itemRefs[idx] = el;
          }}
          flexDirection="row"
          width="100%"
          paddingX={4}
          backgroundColor={isEditing() ? t().backgroundElement : isSel() ? t().backgroundElement : undefined}
        >
          {isEditing() ? (
            <input
              focused
              flexGrow={1}
              placeholder={item.placeholder}
              value={editDraft()}
              onInput={setEditDraft}
              textColor={t().foreground}
              focusedTextColor={t().foreground}
              placeholderColor={t().foregroundMuted}
              cursorColor={t().accent}
              backgroundColor={t().background}
              focusedBackgroundColor={t().backgroundElement}
            />
          ) : (
            <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={displayColor()}>
              {displayValue()}
            </text>
          )}
        </box>
      );
    }
    return (
      <box
        ref={(el: Renderable) => {
          itemRefs[idx] = el;
        }}
        flexDirection="row"
        width="100%"
        paddingX={4}
        backgroundColor={isEditing() ? t().backgroundElementActive : isSel() ? t().backgroundElement : undefined}
      >
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={labelColor()}>
          {item.label}
        </text>
        {isEditing() ? (
          <input
            focused
            width={VALUE_COL_WIDTH + HOTKEY_COL_WIDTH}
            placeholder={item.placeholder}
            value={editDraft()}
            onInput={setEditDraft}
            textColor={t().foreground}
            focusedTextColor={t().foreground}
            placeholderColor={t().foregroundMuted}
            cursorColor={t().accent}
            backgroundColor={t().backgroundElementActive}
            focusedBackgroundColor={t().backgroundElementActive}
          />
        ) : (
          <box width={VALUE_COL_WIDTH} flexShrink={0} flexDirection="row" justifyContent="flex-end">
            <text wrapMode="none" truncate fg={displayColor()}>
              {clipLeft(displayValue(), VALUE_COL_WIDTH)}
            </text>
          </box>
        )}
        {isEditing() ? null : !showValidity() ? (
          <text flexShrink={0} width={HOTKEY_COL_WIDTH} wrapMode="none">
            {" ".repeat(HOTKEY_COL_WIDTH)}
          </text>
        ) : (
          <text flexShrink={0} width={HOTKEY_COL_WIDTH} wrapMode="none" fg={valid() ? t().success : t().error}>
            {(valid() ? "✓" : "✕").padStart(HOTKEY_COL_WIDTH)}
          </text>
        )}
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
    if (item.kind === "editable") return renderEditable(item, idx);
    return renderSettingRow(item, idx);
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
        <DialogTitleBar title="Menu" />

        {/* Tab bar with top accent line per selected tab, muted bottom separator */}
        <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
          {/* Repository tab */}
          <box
            width={tabWidth(0)}
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
            width={tabWidth(1)}
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
          {/* Providers tab */}
          <box
            width={tabWidth(2)}
            flexGrow={1}
            justifyContent="center"
            flexDirection="row"
            border={["top"]}
            borderStyle="single"
            borderColor={activeTab() === "providers" ? t().accent : t().border}
          >
            <text flexShrink={0} wrapMode="none" fg={activeTab() === "providers" ? t().accent : t().foregroundMuted}>
              <strong>{"Providers"}</strong>
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
          {editingIdx() == null ? (
            <>
              <KeyHint key="enter" desc={` ${footerVerb()}`} />
              {(() => {
                const idx = selectedItemIndex();
                const item = idx == null ? undefined : activeItems()[idx];
                return item?.kind === "copyable" && item.onForget ? (
                  <>
                    <KeyHintSeparator />
                    <KeyHint key="f" desc=" forget" />
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
              <KeyHint key="enter" desc=" save" />
              <KeyHintSeparator />
              <KeyHint key="esc" desc=" cancel" />
            </>
          )}
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
