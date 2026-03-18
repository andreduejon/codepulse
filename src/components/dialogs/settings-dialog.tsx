import { createSignal, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useAppState } from "../../context/state";
import { useTheme, themeNames, themes } from "../../context/theme";

interface SettingsDialogProps {
  onClose: () => void;
  onReload: () => void;
  onOpenDialog?: (dialogId: string) => void;
}

const MAX_COUNT_OPTIONS = [10, 20, 50, 100, 200, 500];

type SettingItem =
  | { kind: "header"; label: string }
  | { kind: "toggle"; label: string; hotkey?: string; get: () => boolean; set: (v: boolean) => void; needsReload?: boolean }
  | { kind: "cycle"; label: string; hotkey?: string; options: string[]; get: () => string; set: (v: string) => void; needsReload?: boolean }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: string; get: () => string };

export default function SettingsDialog(props: Readonly<SettingsDialogProps>) {
  const { state, actions } = useAppState();
  const { theme, themeName } = useTheme();
  const t = () => theme();

  // All items including headers
  const items: SettingItem[] = [
    { kind: "header", label: "Appearance" },
    {
      kind: "dialog",
      label: "Color theme",
      hotkey: "ctrl+t",
      dialogId: "theme",
      get: () => themes[themeName()]?.name ?? themeName(),
    },
    { kind: "header", label: "Graph" },
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
  ];

  // Indices of selectable (non-header) items
  const selectableIndices = items
    .map((item, i) => (item.kind === "header" ? -1 : i))
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
      if (item.needsReload) props.onReload();
    } else if (item.kind === "cycle") {
      const currentVal = item.get();
      const currentIdx = item.options.indexOf(currentVal);
      const nextIdx = (currentIdx + 1) % item.options.length;
      item.set(item.options[nextIdx]);
      if (item.needsReload) props.onReload();
    } else if (item.kind === "dialog") {
      props.onOpenDialog?.(item.dialogId);
    }
  };

  const activateItem = () => activateItemAt(selectedItemIndex());

  // Handle navigation within the dialog
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
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={"#00000080"}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={70}
        height="60%"
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
      {/* Title bar */}
      <box flexDirection="row" width="100%" paddingX={4}>
        <text flexGrow={1} wrapMode="none">
          <strong><span fg={t().foreground}>Settings</span></strong>
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          <span fg={t().foregroundMuted}>{"esc".padStart(9)}</span>
        </text>
      </box>
      <box height={1} />

      {/* Settings list */}
      <box flexDirection="column" flexGrow={1}>
        <For each={items}>
          {(item, itemIndex) => {
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

            const isSelected = () => selectedItemIndex() === itemIndex();
            const val = () => valueDisplay(item);

            // Pad value and hotkey to fixed widths for right-alignment
            const paddedVal = () => {
              const v = item.kind === "dialog" ? val() : `[${val()}]`;
              return v.padStart(22);
            };
            const paddedHotkey = () => {
              const h = item.hotkey ?? "";
              return h.padStart(9);
            };

            // Find this item's cursor position for mouse interaction
            const cursorPos = selectableIndices.indexOf(itemIndex());

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
    </box>
    </box>
  );
}
