import { MouseButton } from "@opentui/core";
import { createSignal, type JSX, Show } from "solid-js";
import { useT } from "../hooks/use-t";
import { cellWidth } from "../utils/terminal-text";

interface KeyHintProps {
  key: JSX.Element | string;
  desc: JSX.Element | string;
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * A keybind hint strip: bold key label followed by a muted description.
 * Used in footers and title bars across the app.
 *
 * The `desc` prop should include its own leading/trailing spaces for spacing,
 * e.g. desc=" confirm  " or desc=" help".
 */
export function KeyHint(props: Readonly<KeyHintProps>) {
  const t = useT();
  const [hovered, setHovered] = createSignal(false);
  return (
    <Show
      when={props.onClick && !props.disabled}
      fallback={
        <>
          <text
            selectable={false}
            flexShrink={0}
            wrapMode="none"
            fg={props.disabled ? t().foregroundMuted : t().foreground}
          >
            {props.key}
          </text>
          <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {props.desc}
          </text>
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI action also has its displayed keyboard shortcut. */}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard invokes the same action. */}
      <text
        selectable={false}
        flexShrink={0}
        wrapMode="none"
        fg={hovered() ? t().foreground : t().foregroundMuted}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={event => {
          if (event.button !== MouseButton.LEFT) return;
          event.preventDefault();
          event.stopPropagation();
          props.onClick?.();
        }}
      >
        <span style={{ fg: t().foreground }}>{props.key}</span>
        {props.desc}
      </text>
    </Show>
  );
}

/** A hint in a footer that drops hints to fit: the higher its rank, the sooner it goes. */
export interface RankedHint {
  key: string;
  desc: string;
  rank: number;
}

/**
 * The hints that fit in `room` cells with ` · ` between them: the least needed (highest rank, the later one first)
 * go until the rest fit. Whole hints go, so none is cut and no separator is left at the end. One always stays.
 */
export function fitHints<T extends RankedHint>(hints: readonly T[], room: number): T[] {
  const width = (list: readonly T[]) =>
    list.reduce((sum, hint) => sum + cellWidth(hint.key + hint.desc), 0) + Math.max(0, list.length - 1) * 3;
  let kept = [...hints];
  while (kept.length > 1 && width(kept) > room) {
    let drop = 0;
    kept.forEach((hint, index) => {
      if (hint.rank >= (kept[drop]?.rank ?? 0)) drop = index;
    });
    kept = kept.filter((_, index) => index !== drop);
  }
  return kept;
}

export function KeyHintSeparator() {
  const t = useT();
  return (
    <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
      {" · "}
    </text>
  );
}
