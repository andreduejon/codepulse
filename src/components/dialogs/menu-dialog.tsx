import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, type JSX, onCleanup } from "solid-js";
import type { ConfigInfo } from "../../config";
import { SHIFT_JUMP } from "../../constants";
import { useTheme } from "../../context/theme";
import { getColorForColumn } from "../../git/graph";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useClipboard } from "../../hooks/use-clipboard";
import { COPYABLE_VISIBLE_WIDTH, INFO_LABEL_WIDTH, type SettingItem, useMenuItems } from "../../hooks/use-menu-items";
import { scrollElementIntoView } from "../../utils/scroll";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

type MenuTab = "repository" | "branch";

/** Column widths for the menu item value and hotkey display columns. */
const VALUE_COL_WIDTH = 22;
const HOTKEY_COL_WIDTH = 9;

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

/** Persists the last-used tab across dialog open/close cycles. */
const [lastMenuTab, setLastMenuTab] = createSignal<MenuTab>("repository");

export default function MenuDialog(props: Readonly<MenuDialogProps>) {
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
    configScope,
    setConfigScope,
    savedFeedback,
    showSavedFeedback,
    copyToClipboard,
    onFetch: () => props.onFetch(),
    onReload: () => props.onReload(),
    onOpenDialog: props.onOpenDialog,
    onViewBranch: branch => props.onViewBranch(branch),
    onClose: () => props.onClose(),
    configInfo: props.configInfo,
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
      if (!v) return " ".padStart(VALUE_COL_WIDTH);
      if (item.kind === "dialog" || item.kind === "action") return v.padStart(VALUE_COL_WIDTH);
      return `[${v}]`.padStart(VALUE_COL_WIDTH);
    };
    const paddedHotkey = () => {
      if (isDisabledAction()) return "";
      const h =
        item.kind === "toggle" || item.kind === "cycle" || item.kind === "dialog" || item.kind === "action"
          ? (item.hotkey ?? "")
          : "";
      return h.padStart(HOTKEY_COL_WIDTH);
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
