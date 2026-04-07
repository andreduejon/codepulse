import type { JSX } from "solid-js";
import { useT } from "../hooks/use-t";

interface KeyHintProps {
  key: JSX.Element | string;
  desc: JSX.Element | string;
}

/**
 * A duotone badge hint: key in accent + desc in muted, both on a shared
 * backgroundElement background. Single padded pill per hint.
 *
 * Usage: wrap consecutive hints with a gap between them by including
 * trailing spaces in `desc`, e.g. desc=" switch tab  " (two trailing spaces
 * act as the inter-badge gap since the next badge's leading space follows).
 */
export function KeyHint(props: Readonly<KeyHintProps>) {
  const t = useT();
  return (
    <>
      <text flexShrink={0} wrapMode="none" fg={t().accent} bg={t().backgroundElement}>
        {" "}
        {props.key}
      </text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted} bg={t().backgroundElement}>
        {props.desc}{" "}
      </text>
    </>
  );
}
