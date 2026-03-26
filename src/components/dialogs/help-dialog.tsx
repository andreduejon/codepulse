import { useTheme } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(props: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = () => theme();

  const keybinds = [
    ["↑/↓", "Navigate list"],
    ["Shift+↑/↓", "Jump 10 entries"],
    ["PgUp/PgDn", "Jump 20 entries"],
    ["g/G", "First / last commit"],
    ["Enter", "Focus detail / activate"],
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
        width={60}
        height={keybinds.length + 5}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Keyboard Shortcuts" />

        {/* Keybind list */}
        <box flexDirection="column" flexGrow={1}>
          {keybinds.map(([key, desc]) => (
            <box flexDirection="row" width="100%" paddingX={4}>
              <text flexShrink={0} wrapMode="none" fg={t().accent}>
                <strong>{(key ?? "").padEnd(16)}</strong>
              </text>
              <text flexGrow={1} wrapMode="none" fg={t().foreground}>
                {desc}
              </text>
            </box>
          ))}
        </box>
      </box>
    </DialogOverlay>
  );
}
