import { useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { useTheme } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(_props: Readonly<{ onClose: () => void }>) {
  const { theme } = useTheme();
  const t = () => theme();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(keybinds.length + 5, dimensions().height - 8);

  const keybinds = [
    ["↑/↓", "Navigate list"],
    ["Shift+↑/↓", "Jump 10 entries"],
    ["PgUp/PgDn", "Jump 20 entries"],
    ["g/G", "First / last commit"],
    ["Enter", "Focus detail / activate"],
    ["Enter (file)", "View diff"],
    ["←/→ (diff)", "Previous / next file"],
    ["PgUp/PgDn (diff)", "Scroll half page"],
    ["b (diff)", "Toggle blame"],
    ["c (diff)", "Cycle view: mixed/new/old"],
    ["→/←", "Focus detail / return to graph"],
    ["Esc", "Back (cascade)"],
    ["q", "Back, or quit"],
    ["/", "Search commits"],
    ["f", "Fetch from remote"],
    ["R", "Reload data"],
    ["m", "Menu"],
    ["Ctrl+T", "Change theme"],
    ["?", "Show this help"],
  ];

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
        <DialogTitleBar title="Keyboard Shortcuts" />

        {/* Keybind list — scrollable when terminal height is small */}
        <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={keybinds}>
              {([key, desc]) => (
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().accent}>
                    <strong>{(key ?? "").padEnd(16)}</strong>
                  </text>
                  <text flexGrow={1} wrapMode="none" fg={t().foreground}>
                    {desc}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
      </box>
    </DialogOverlay>
  );
}
