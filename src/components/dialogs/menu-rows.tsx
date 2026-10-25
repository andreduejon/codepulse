import type { MouseEvent, Renderable } from "@opentui/core";
import type { JSX } from "solid-js";
import type { Theme } from "../../context/theme";
import { COPYABLE_VISIBLE_WIDTH, type SettingItem } from "../../hooks/use-menu-items";
import Badge from "../badge";

/** Column widths for the menu item value and hotkey display columns. */
const VALUE_COL_WIDTH = 34;
const HOTKEY_COL_WIDTH = 9;

const clipLeft = (value: string, width: number) => (value.length <= width ? value : `…${value.slice(-(width - 1))}`);

/** What the menu rows read from the dialog: selection, hover, mouse handlers, copy feedback and the token editor. */
export interface MenuRowsView {
  t: () => Theme;
  selectedIndex: () => number | undefined;
  hoveredItem: () => SettingItem | null;
  rowMouse: (
    item: SettingItem,
    idx: number,
  ) => { onMouseOver: () => void; onMouseOut: () => void; onMouseDown: (event: MouseEvent) => void };
  itemRef: (item: SettingItem) => (el: Renderable) => void;
  copiedLabel: () => string | null;
  /** The visible slice of a copyable value; selected values banner-scroll. */
  copyableText: (text: string, isSelected: boolean, width?: number) => string;
  branchTrackWidths: () => { addColWidth: number; delColWidth: number };
  valueDisplay: (item: SettingItem) => string;
  editingIdx: () => number | null;
  editDraft: () => string;
  setEditDraft: (value: string) => void;
}

const renderHeader = (v: MenuRowsView, item: Extract<SettingItem, { kind: "header" }>, idx: number) => (
  <box ref={v.itemRef(item)} flexDirection="column" width="100%" paddingX={4}>
    {idx > 0 ? <box height={1} /> : null}
    <box flexDirection="row" width="100%">
      <text flexGrow={1} wrapMode="none" fg={item.tone === "muted" ? v.t().foregroundMuted : v.t().accent}>
        <strong>
          <span>{item.label}</span>
        </strong>
      </text>
      {item.get ? (
        <>
          <box width={VALUE_COL_WIDTH} flexShrink={0} flexDirection="row" justifyContent="flex-end">
            <text wrapMode="none" truncate fg={v.t().foregroundMuted}>
              {clipLeft(item.get(), VALUE_COL_WIDTH)}
            </text>
          </box>
          <box width={HOTKEY_COL_WIDTH} flexShrink={0} />
        </>
      ) : null}
    </box>
  </box>
);

const renderInfo = (v: MenuRowsView, item: Extract<SettingItem, { kind: "info" }>) => {
  const hasStatus = () => item.valid != null;
  const isValid = () => item.valid?.() ?? false;
  return (
    <box ref={v.itemRef(item)} flexDirection="row" width="100%" paddingX={4}>
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={v.t().foregroundMuted}>
        {item.label}
      </text>
      <text flexShrink={0} wrapMode="none" fg={v.t().foregroundMuted}>
        {clipLeft(item.get(), VALUE_COL_WIDTH).padStart(VALUE_COL_WIDTH)}
      </text>
      {hasStatus() ? (
        <text flexShrink={0} width={HOTKEY_COL_WIDTH} wrapMode="none" fg={isValid() ? v.t().success : v.t().error}>
          {(isValid() ? "✓" : "✕").padStart(HOTKEY_COL_WIDTH)}
        </text>
      ) : (
        <box width={HOTKEY_COL_WIDTH} flexShrink={0} />
      )}
    </box>
  );
};

const renderBadge = (v: MenuRowsView, item: Extract<SettingItem, { kind: "badge" }>) => {
  return (
    <box ref={v.itemRef(item)} flexDirection="row" width="100%" paddingX={4}>
      <Badge name={item.name} colorIndex={item.colorIndex} dimmed={item.dimmed} maxLength={30} />
    </box>
  );
};

const renderCopyable = (v: MenuRowsView, item: Extract<SettingItem, { kind: "copyable" }>, idx: number) => {
  const isSel = () => v.selectedIndex() === idx;
  const isCopied = () => v.copiedLabel() === item.label;
  const textWidth = () => Math.max(1, COPYABLE_VISIBLE_WIDTH - (item.visualPrefix?.length ?? 0));
  return (
    <box
      ref={v.itemRef(item)}
      flexDirection="row"
      width="100%"
      paddingX={4}
      {...v.rowMouse(item, idx)}
      backgroundColor={isSel() || v.hoveredItem() === item ? v.t().backgroundElement : undefined}
    >
      {item.visualPrefix ? (
        <text flexShrink={0} wrapMode="none" fg={v.t().foregroundMuted}>
          {item.visualPrefix}
        </text>
      ) : null}
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={isSel() ? v.t().accent : v.t().foreground}>
        {v.copyableText(item.get(), isSel(), textWidth())}
      </text>
      {isCopied() ? (
        <text flexShrink={0} wrapMode="none" bg={v.t().primary} fg={v.t().background}>
          {" \u2713 copied "}
        </text>
      ) : null}
    </box>
  );
};

const renderSection = (v: MenuRowsView, item: Extract<SettingItem, { kind: "section" }>, idx: number) => {
  const isSel = () => v.selectedIndex() === idx;
  const indicator = () => (item.collapsed() ? "▸" : "▾");
  return (
    <box ref={v.itemRef(item)} flexDirection="column" width="100%" paddingX={4}>
      {idx > 0 ? <box height={1} /> : null}
      <box
        flexDirection="row"
        width="100%"
        {...v.rowMouse(item, idx)}
        backgroundColor={isSel() || v.hoveredItem() === item ? v.t().backgroundElement : undefined}
      >
        <text flexShrink={0} wrapMode="none" fg={v.t().accent}>
          <strong>
            <span>{`${indicator()} ${item.label}`}</span>
          </strong>
        </text>
        <text flexShrink={0} wrapMode="none" fg={v.t().foregroundMuted}>
          {` (${item.count})`}
        </text>
      </box>
    </box>
  );
};

const renderBranch = (v: MenuRowsView, item: Extract<SettingItem, { kind: "branch" }>, idx: number) => {
  const isSel = () => v.selectedIndex() === idx;
  const hasTracking = () => item.upstream != null;
  return (
    <box
      ref={v.itemRef(item)}
      flexDirection="row"
      width="100%"
      paddingLeft={6}
      paddingRight={4}
      {...v.rowMouse(item, idx)}
      backgroundColor={isSel() || v.hoveredItem() === item ? v.t().backgroundElement : undefined}
    >
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={isSel() ? v.t().accent : v.t().foreground}>
        {item.name}
      </text>
      {hasTracking() ? (
        <text flexShrink={0} wrapMode="none" fg={v.t().foregroundMuted}>
          {"  "}
          {`↑${item.ahead ?? 0}`.padStart(v.branchTrackWidths().addColWidth)}{" "}
          {`↓${item.behind ?? 0}`.padStart(v.branchTrackWidths().delColWidth)}
        </text>
      ) : null}
    </box>
  );
};

const renderSettingRow = (
  v: MenuRowsView,
  item: Extract<SettingItem, { kind: "toggle" | "cycle" | "dialog" | "action" }>,
  idx: number,
) => {
  const isDisabled = () => (item.kind === "action" || item.kind === "toggle") && !!item.disabled?.();
  const isSelected = () => !isDisabled() && v.selectedIndex() === idx;
  const val = () => v.valueDisplay(item);

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

  const labelColor = () => (isDisabled() ? v.t().foregroundMuted : isSelected() ? v.t().accent : v.t().foreground);
  const valueColor = () => (isDisabled() ? v.t().foregroundMuted : v.t().foreground);

  return (
    <box
      ref={v.itemRef(item)}
      flexDirection="row"
      width="100%"
      paddingX={4}
      {...(!isDisabled() ? v.rowMouse(item, idx) : {})}
      backgroundColor={
        isSelected() || (!isDisabled() && v.hoveredItem() === item) ? v.t().backgroundElement : undefined
      }
    >
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={labelColor()}>
        {item.label}
      </text>
      <text flexShrink={0} wrapMode="none" fg={valueColor()}>
        {paddedVal()}
      </text>
      <text flexShrink={0} wrapMode="none" fg={v.t().foregroundMuted}>
        {paddedHotkey()}
      </text>
    </box>
  );
};

const renderEditable = (v: MenuRowsView, item: Extract<SettingItem, { kind: "editable" }>, idx: number) => {
  const isSel = () => v.selectedIndex() === idx;
  const isEditing = () => v.editingIdx() === idx;
  const valid = () => item.valid?.();
  const showValidity = () => item.showValidity ?? true;
  const savedValue = () => item.get().trim();
  const displayValue = () => savedValue() || item.placeholder || "";
  const labelColor = () => (isSel() ? v.t().accent : v.t().foreground);
  const displayColor = () => (savedValue() ? (isSel() ? v.t().accent : v.t().foreground) : v.t().foregroundMuted);
  if (item.fullWidth) {
    return (
      <box
        ref={v.itemRef(item)}
        flexDirection="row"
        width="100%"
        paddingX={4}
        {...v.rowMouse(item, idx)}
        backgroundColor={isEditing() || isSel() || v.hoveredItem() === item ? v.t().backgroundElement : undefined}
      >
        {isEditing() ? (
          <input
            focused
            flexGrow={1}
            placeholder={item.placeholder}
            value={v.editDraft()}
            onInput={v.setEditDraft}
            textColor={v.t().foreground}
            focusedTextColor={v.t().foreground}
            placeholderColor={v.t().foregroundMuted}
            cursorColor={v.t().accent}
            backgroundColor={v.t().background}
            focusedBackgroundColor={v.t().backgroundElement}
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
      ref={v.itemRef(item)}
      flexDirection="row"
      width="100%"
      paddingX={4}
      {...v.rowMouse(item, idx)}
      backgroundColor={
        isEditing()
          ? v.t().backgroundElementActive
          : isSel() || v.hoveredItem() === item
            ? v.t().backgroundElement
            : undefined
      }
    >
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={labelColor()}>
        {item.label}
      </text>
      {isEditing() ? (
        <input
          focused
          width={VALUE_COL_WIDTH + HOTKEY_COL_WIDTH}
          placeholder={item.placeholder}
          value={v.editDraft()}
          onInput={v.setEditDraft}
          textColor={v.t().foreground}
          focusedTextColor={v.t().foreground}
          placeholderColor={v.t().foregroundMuted}
          cursorColor={v.t().accent}
          backgroundColor={v.t().backgroundElementActive}
          focusedBackgroundColor={v.t().backgroundElementActive}
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
        <text flexShrink={0} width={HOTKEY_COL_WIDTH} wrapMode="none" fg={valid() ? v.t().success : v.t().error}>
          {(valid() ? "✓" : "✕").padStart(HOTKEY_COL_WIDTH)}
        </text>
      )}
    </box>
  );
};

/** One menu row, rendered by its kind. */
export function MenuRow(props: Readonly<{ view: MenuRowsView; item: SettingItem; index: number }>): JSX.Element {
  const v = props.view;
  const item = props.item;
  const idx = props.index;
  if (item.kind === "header") return renderHeader(v, item, idx);
  if (item.kind === "info") return renderInfo(v, item);
  if (item.kind === "badge") return renderBadge(v, item);
  if (item.kind === "copyable") return renderCopyable(v, item, idx);
  if (item.kind === "section") return renderSection(v, item, idx);
  if (item.kind === "branch") return renderBranch(v, item, idx);
  if (item.kind === "editable") return renderEditable(v, item, idx);
  return renderSettingRow(v, item, idx);
}
