import { useTheme } from "../../context/theme";

export default function HelpDialog(props: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = () => theme();

  const keybinds = [
    ["↓ / ↑", "Move selection down / up"],
    ["→", "Focus detail panel"],
    ["←", "Return to commit list / recenter"],
    ["g", "Go to first commit"],
    ["G", "Go to last commit"],
    ["/", "Search commits"],
    ["esc", "Clear search / close dialog"],
    ["a", "Toggle all branches"],
    ["b", "Open branch picker"],
    ["T", "Toggle tag visibility"],
    ["f", "Focus current branch"],
    ["ctrl+t", "Change theme"],
    ["ctrl+s", "Settings"],
    ["F1", "Show this help"],
    ["F5", "Refresh"],
    ["q / ctrl+c", "Quit"],
  ];

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
      onMouseDown={() => props.onClose()}
    >
      <box
        width={60}
        height={keybinds.length + 5}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        onMouseDown={(e: any) => { e.stopPropagation(); e.preventDefault(); }}
      >
        {/* Title bar */}
        <box flexDirection="row" width="100%" paddingX={4}>
          <text flexGrow={1} wrapMode="none">
            <strong><span fg={t().foreground}>Keyboard Shortcuts</span></strong>
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            <span fg={t().foregroundMuted}>{"esc".padStart(9)}</span>
          </text>
        </box>
        <box height={1} />

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
    </box>
  );
}
