import { createSignal, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useAppState } from "../context/state";
import { useTheme, themeNames, themes } from "../context/theme";

interface SettingsDialogProps {
  onClose: () => void;
  onReload: () => void;
}

const MAX_COUNT_OPTIONS = [10, 20, 50, 100, 200, 500];

type SettingItem =
  | { kind: "header"; label: string }
  | { kind: "toggle"; label: string; hotkey?: string; get: () => boolean; set: (v: boolean) => void; needsReload?: boolean }
  | { kind: "cycle"; label: string; hotkey?: string; options: string[]; get: () => string; set: (v: string) => void; needsReload?: boolean };

export default function SettingsDialog(props: SettingsDialogProps) {
  const { state, actions } = useAppState();
  const { theme, setTheme, themeName } = useTheme();
  const t = () => theme();

  // All items including headers
  const items: SettingItem[] = [
    { kind: "header", label: "Appearance" },
    {
      kind: "cycle",
      label: "Color theme",
      hotkey: "t",
      options: themeNames.map((n) => themes[n].name),
      get: () => themes[themeName()]?.name ?? themeName(),
      set: (displayName: string) => {
        const key = themeNames.find((n) => themes[n].name === displayName);
        if (key) setTheme(key);
      },
    },
    { kind: "header", label: "Display" },
    {
      kind: "toggle",
      label: "Show tags",
      hotkey: "T",
      get: () => state.showTags(),
      set: (v) => actions.setShowTags(v),
    },
    {
      kind: "toggle",
      label: "Show detail panel",
      hotkey: "enter",
      get: () => state.showDetailPanel(),
      set: (v) => actions.setShowDetailPanel(v),
    },
    {
      kind: "toggle",
      label: "Focus current branch",
      hotkey: "f",
      get: () => state.focusCurrentBranch(),
      set: (v) => actions.setFocusCurrentBranch(v),
    },
    { kind: "header", label: "Graph" },
    {
      kind: "cycle",
      label: "Max commits",
      options: MAX_COUNT_OPTIONS.map(String),
      get: () => String(state.maxCount()),
      set: (v) => actions.setMaxCount(parseInt(v, 10)),
      needsReload: true,
    },
    {
      kind: "toggle",
      label: "Dim remote-only branches",
      get: () => state.dimRemoteOnly(),
      set: (v) => actions.setDimRemoteOnly(v),
    },
    {
      kind: "toggle",
      label: "Show all branches",
      hotkey: "a",
      get: () => state.showAllBranches(),
      set: (v) => actions.setShowAllBranches(v),
      needsReload: true,
    },
  ];

  // Indices of selectable (non-header) items
  const selectableIndices = items
    .map((item, i) => (item.kind !== "header" ? i : -1))
    .filter((i) => i >= 0);

  const [cursor, setCursor] = createSignal(0); // index into selectableIndices

  const selectedItemIndex = () => selectableIndices[cursor()];

  const moveCursor = (delta: number) => {
    const len = selectableIndices.length;
    setCursor((c) => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const activateItemAt = (itemIdx: number) => {
    const item = items[itemIdx];
    if (!item || item.kind === "header") return;

    if (item.kind === "toggle") {
      item.set(!item.get());
    } else if (item.kind === "cycle") {
      const currentVal = item.get();
      const currentIdx = item.options.indexOf(currentVal);
      const nextIdx = (currentIdx + 1) % item.options.length;
      item.set(item.options[nextIdx]);
    }

    if (item.needsReload) {
      props.onReload();
    }
  };

  const activateItem = () => activateItemAt(selectedItemIndex());

  // Handle navigation within the dialog
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "j":
      case "down":
        moveCursor(1);
        break;
      case "k":
      case "up":
        moveCursor(-1);
        break;
      case "return":
        activateItem();
        break;
    }
  });

  // Format the value display for an item
  const valueDisplay = (item: SettingItem): string => {
    if (item.kind === "header") return "";
    if (item.kind === "toggle") return item.get() ? "on" : "off";
    return item.get();
  };

  return (
    <box
      position="absolute"
      top="15%"
      left="25%"
      width="50%"
      height="70%"
      backgroundColor={t().backgroundPanel}
      border={true}
      borderColor={t().borderActive}
      borderStyle="rounded"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      {/* Title bar */}
      <box flexDirection="row" width="100%">
        <text flexGrow={1} wrapMode="none">
          <strong><span fg={t().foreground}>Settings</span></strong>
        </text>
        <text flexShrink={0} wrapMode="none">
          <span fg={t().foregroundMuted}>esc</span>
        </text>
      </box>
      <box height={1} />

      {/* Settings list */}
      <box flexDirection="column" flexGrow={1}>
        <For each={items}>
          {(item, itemIndex) => {
            if (item.kind === "header") {
              return (
                <box flexDirection="column" width="100%">
                  {itemIndex() > 0 ? <box height={1} /> : null}
                  <text wrapMode="none" fg={t().accent}>
                    <strong><span fg={t().accent}>{item.label}</span></strong>
                  </text>
                </box>
              );
            }

            const isSelected = () => selectedItemIndex() === itemIndex();
            const val = () => valueDisplay(item);

            // Pad value and hotkey to fixed widths for right-alignment
            const paddedVal = () => {
              const v = `[${val()}]`;
              return v.padStart(22);
            };
            const paddedHotkey = () => {
              const h = item.hotkey ?? "";
              return h.padStart(8);
            };

            // Find this item's cursor position for mouse interaction
            const cursorPos = selectableIndices.indexOf(itemIndex());

            return (
              <box
                flexDirection="row"
                width="100%"
                backgroundColor={isSelected() ? t().backgroundElement : undefined}
                onMouseMove={() => {
                  if (cursorPos >= 0) setCursor(cursorPos);
                }}
                onMouseDown={() => {
                  if (cursorPos >= 0) {
                    setCursor(cursorPos);
                    activateItemAt(itemIndex());
                  }
                }}
              >
                {/* Setting name */}
                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
                  <span fg={isSelected() ? t().primary : t().foreground}>
                    {item.label}
                  </span>
                </text>

                {/* Current value — right-aligned, in brackets */}
                <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                  <span fg={t().foregroundMuted}>{paddedVal()}</span>
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

      {/* Footer hint */}
      <text wrapMode="none">
        <span fg={t().foregroundMuted}>Enter to toggle/cycle · Esc to close</span>
      </text>
    </box>
  );
}
