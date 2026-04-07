import { useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { useT } from "../../hooks/use-t";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(_props: Readonly<{ onClose: () => void }>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(keybinds.length + 8, dimensions().height - 8);

  const keybinds = [
    // Navigation
    ["↑/↓  or  j/k", "Navigate list (1 row)"],
    ["Shift+↑/↓  or  J/K", "Jump 10 rows"],
    ["PgUp/PgDn", "Jump 20 rows"],
    ["g / G", "First / last commit"],
    ["→ / l", "Focus detail panel"],
    ["← / h", "Return to graph"],
    ["Enter", "Open detail / activate item"],
    // Detail panel
    ["←/→ (detail)", "Switch tab"],
    ["↑/↓ (detail)", "Navigate items"],
    // Diff dialog
    ["Enter (file)", "View diff"],
    ["←/→ (diff)", "Previous / next file"],
    ["PgUp/PgDn (diff)", "Scroll half page"],
    ["b (diff)", "Toggle blame"],
    ["c (diff)", "Cycle view: mixed/new/old"],
    ["w (diff)", "Toggle line wrap"],
    // Command bar
    [":", "Open command bar"],
    ["/", "Search commits"],
    ["Esc", "Back / cancel (cascade)"],
    // Commands (via :)
    [":q  /  :quit", "Quit the application"],
    [":m  /  :menu", "Open menu"],
    [":f  /  :fetch", "Fetch from remote"],
    [":r  /  :reload", "Reload data"],
    [":p  /  :path", "Filter by path"],
    [":search", "Open search"],
    [":theme", "Change theme"],
    [":help", "Show this help"],
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
