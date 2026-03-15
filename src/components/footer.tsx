import { useTheme } from "../context/theme";

export default function Footer() {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
    >
      {/* Spacer pushes everything right */}
      <box flexGrow={1} />

      {/* Keyboard hints */}
      <text flexShrink={0} wrapMode="none">
        <span fg={t().foreground}>↑/↓</span>
        <span fg={t().foregroundMuted}> navigate  </span>
        <span fg={t().foreground}>enter</span>
        <span fg={t().foregroundMuted}> details  </span>
        <span fg={t().foreground}>/</span>
        <span fg={t().foregroundMuted}> search  </span>
        <span fg={t().foreground}>ctrl+s</span>
        <span fg={t().foregroundMuted}> settings  </span>
        <span fg={t().foreground}>?</span>
        <span fg={t().foregroundMuted}> help</span>
      </text>

      {/* Separator + Branding */}
      <text flexShrink={0} wrapMode="none" paddingLeft={2}>
        <span fg={t().foregroundMuted}>• gittree v0.1.0</span>
      </text>
    </box>
  );
}
