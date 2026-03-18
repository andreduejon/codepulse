import type { JSX } from "solid-js";
import { useTheme } from "../../context/theme";

/**
 * Full-screen semi-transparent overlay that centers its children.
 * Shared by all dialog components.
 */
export function DialogOverlay(props: { children: JSX.Element }) {
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
    >
      {props.children}
    </box>
  );
}

/**
 * Shared title bar for dialogs: bold title on the left, "esc" hint on the right,
 * followed by a 1-row spacer.
 */
export function DialogTitleBar(props: { title: string }) {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <>
      <box flexDirection="row" width="100%" paddingX={4}>
        <text flexGrow={1} wrapMode="none">
          <strong><span fg={t().foreground}>{props.title}</span></strong>
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          <span fg={t().foregroundMuted}>{"esc".padStart(9)}</span>
        </text>
      </box>
      <box height={1} />
    </>
  );
}
