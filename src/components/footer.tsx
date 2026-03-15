import { useTheme } from "../context/theme";

export default function Footer() {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor={t().backgroundPanel}
      paddingX={1}
      border={["top"]}
      borderColor={t().border}
      borderStyle="single"
    >
      {/* Keyboard hints */}
      <text flexShrink={0} wrapMode="none">
        <span fg={t().foreground}>j/k</span>
        <span fg={t().foregroundMuted}> navigate  </span>
        <span fg={t().foreground}>enter</span>
        <span fg={t().foregroundMuted}> details  </span>
        <span fg={t().foreground}>/</span>
        <span fg={t().foregroundMuted}> search  </span>
        <span fg={t().foreground}>a</span>
        <span fg={t().foregroundMuted}> all branches  </span>
        <span fg={t().foreground}>T</span>
        <span fg={t().foregroundMuted}> tags  </span>
        <span fg={t().foreground}>f</span>
        <span fg={t().foregroundMuted}> focus  </span>
        <span fg={t().foreground}>ctrl+t</span>
        <span fg={t().foregroundMuted}> theme  </span>
        <span fg={t().foreground}>ctrl+s</span>
        <span fg={t().foregroundMuted}> settings  </span>
        <span fg={t().foreground}>ctrl+h</span>
        <span fg={t().foregroundMuted}> help  </span>
        <span fg={t().foreground}>q</span>
        <span fg={t().foregroundMuted}> quit</span>
      </text>

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Branding */}
      <text flexShrink={0} wrapMode="none">
        <span fg={t().foregroundMuted}>gittree v0.1.0</span>
      </text>
    </box>
  );
}
