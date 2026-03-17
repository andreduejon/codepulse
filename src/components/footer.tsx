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

      {/* Keyboard hints — right-aligned, separate <text> per color segment */}
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>←/→</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" navigate  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>ctrl+s</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" settings  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>f5</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" refresh  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>f1</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" help"}</text>
    </box>
  );
}
