import type { JSX } from "solid-js";
import { useTheme } from "../context/theme";

interface KeyHintProps {
  key: JSX.Element | string;
  desc: JSX.Element | string;
}

/**
 * A keybind hint strip: bold key label followed by a muted description.
 * Used in footers and title bars across the app.
 *
 * The `desc` prop should include its own leading/trailing spaces for spacing,
 * e.g. desc=" confirm  " or desc=" help".
 */
export function KeyHint(props: Readonly<KeyHintProps>) {
  const { theme } = useTheme();
  const t = () => theme();
  return (
    <>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>
        {props.key}
      </text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
        {props.desc}
      </text>
    </>
  );
}
