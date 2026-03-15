import { useTheme } from "../context/theme";

export default function HelpDialog(props: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = () => theme();

  const keybinds = [
    ["j / Down", "Move selection down"],
    ["k / Up", "Move selection up"],
    ["g", "Go to first commit"],
    ["G", "Go to last commit"],
    ["Enter", "Toggle commit details"],
    ["/", "Search commits"],
    ["Esc", "Clear search / close dialog"],
    ["a", "Toggle all branches"],
    ["b", "Open branch picker"],
    ["T", "Toggle tag visibility"],
    ["f", "Focus current branch"],
    ["Ctrl+T", "Change theme"],
    ["Ctrl+S", "Settings"],
    ["?", "Show this help"],
    ["q / Ctrl+C", "Quit"],
  ];

  return (
    <box
      position="absolute"
      top="15%"
      left="20%"
      width="60%"
      height="70%"
      backgroundColor={t().backgroundPanel}
      border={true}
      borderColor={t().borderActive}
      borderStyle="rounded"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <text wrapMode="none">
        <span fg={t().primary}>Keyboard Shortcuts</span>
      </text>
      <box height={1} />
      {keybinds.map(([key, desc]) => (
        <box flexDirection="row" width="100%">
          <text flexShrink={0} width={20} wrapMode="none">
            <span fg={t().primary}>{key}</span>
          </text>
          <text flexGrow={1} fg={t().foreground} wrapMode="none">
            {desc}
          </text>
        </box>
      ))}
      <box flexGrow={1} />
      <text wrapMode="none">
        <span fg={t().foregroundMuted}>Press Esc or ? to close</span>
      </text>
    </box>
  );
}
