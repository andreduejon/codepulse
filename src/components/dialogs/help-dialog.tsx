import { useTheme } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(props: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = () => theme();

  const keybinds = [
    ["↓/↑ or j/k", "Move selection down / up"],
    ["Shift+↓/↑", "Jump 10 entries down / up"],
    ["→/l or Tab", "Focus detail panel"],
    ["←/h", "Return to commit list / recenter"],
    ["g", "Go to first commit"],
    ["G", "Go to last commit"],
    ["/", "Search commits"],
    ["esc", "Clear search / close dialog / go back"],
    ["a", "Toggle all branches"],
    ["f", "Fetch from remote"],
    ["R", "Reload data"],
    ["ctrl+r", "Open menu (repository)"],
    ["ctrl+b", "Open menu (branch)"],
    ["ctrl+t", "Change theme"],
    ["?", "Show this help"],
    ["q", "Quit (or close dialog)"],
    ["ctrl+q", "Quit"],
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
                {(key ?? "").padEnd(16)}
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
