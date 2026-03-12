import { useTheme, themeNames, themes } from "../context/theme";

export default function ThemeDialog(props: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const t = () => theme();

  const options = themeNames.map((name) => ({
    name: themes[name].name,
    description: name,
  }));

  return (
    <box
      position="absolute"
      top="25%"
      left="30%"
      width="40%"
      height="50%"
      backgroundColor={t().backgroundPanel}
      border={true}
      borderColor={t().borderActive}
      borderStyle="rounded"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
    >
      <text wrapMode="none">
        <span fg={t().primary}>Select Theme</span>
      </text>
      <box height={1} />
      <select
        focused
        flexGrow={1}
        options={options}
        backgroundColor={t().backgroundPanel}
        textColor={t().foreground}
        selectedBackgroundColor={t().backgroundElement}
        selectedTextColor={t().primary}
        focusedBackgroundColor={t().backgroundPanel}
        focusedTextColor={t().foreground}
        descriptionColor={t().foregroundMuted}
        selectedDescriptionColor={t().foregroundMuted}
        onSelect={(idx) => {
          const name = themeNames[idx];
          if (name) {
            setTheme(name);
            props.onClose();
          }
        }}
      />
      <box height={1} />
      <text wrapMode="none">
        <span fg={t().foregroundMuted}>Enter to select · Esc to cancel</span>
      </text>
    </box>
  );
}
