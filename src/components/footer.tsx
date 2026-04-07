import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { KeyHint } from "./key-hint";

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 120;

export default function Footer(
  props: Readonly<{ commandBarMode: () => CommandBarMode; filterActive?: boolean; compact?: boolean }>,
) {
  const t = useT();
  const { state } = useAppState();

  const isLoading = () => state.loading() || state.fetching() || state.detailLoading();

  const loadingLabel = () => (isLoading() ? " loading" : "");

  // Animation frame counter, cycles while loading
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (isLoading()) {
      setFrame(0);
      if (!spinnerTimer) {
        spinnerTimer = setInterval(() => {
          setFrame(f => (f + 1) % SPINNER_FRAMES.length);
        }, SPINNER_FRAME_MS);
      }
    } else {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
    }
  });

  onCleanup(() => {
    if (spinnerTimer) clearInterval(spinnerTimer);
  });

  // Always render the spinner element to avoid layout shift;
  // show the braille char when loading, empty space when idle.
  const spinnerChar = () => (isLoading() ? SPINNER_FRAMES[frame()] : " ");

  const enterAction = () => (state.detailFocused() ? state.detailCursorAction() : null);

  const mode = () => props.commandBarMode();

  return (
    <>
      <box flexDirection="row" width="100%" height={1}>
        {/* Loading indicator — always present to avoid layout shift, left-aligned */}
        <text flexShrink={0} wrapMode="none" fg={t().accent}>
          {spinnerChar()}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {loadingLabel()}
        </text>

        {/* Spacer pushes hints right */}
        <box flexGrow={1} />

        {/* ── Detail focused ───────────────────────────────────────────────── */}
        <Show when={state.detailFocused()}>
          <KeyHint key={enterAction() ? "enter" : ""} desc={enterAction() ? ` ${enterAction()}  ` : ""} />
          <KeyHint key="esc" desc=" back  " />
          <KeyHint key="←/→" desc=" switch tab  " />
          <KeyHint key="↑/↓" desc=" navigate" />
        </Show>

        {/* ── Input modes (command / search / path) ────────────────────────── */}
        <Show when={!state.detailFocused() && mode() !== "idle"}>
          <KeyHint key="enter" desc=" confirm  " />
          <KeyHint key="esc" desc=" cancel  " />
          <KeyHint key="Shift+←/→" desc=" switch mode" />
        </Show>

        {/* ── Graph idle ───────────────────────────────────────────────────── */}
        <Show when={!state.detailFocused() && mode() === "idle"}>
          <Show when={props.filterActive}>
            <KeyHint key="esc" desc=" clear  " />
          </Show>
          <Show when={props.compact} fallback={<KeyHint key="←/→" desc=" switch tab  " />}>
            <KeyHint key="enter" desc=" show details  " />
          </Show>
          <KeyHint key="Shift+←/→" desc=" switch mode  " />
          <KeyHint key="↑/↓" desc=" navigate" />
        </Show>
      </box>
      <box height={1} />
    </>
  );
}
