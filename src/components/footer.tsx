import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import {
  getEnabledProviderViews,
  getProviderRegistryVersion,
  nextProviderView,
  providerDisplayName,
} from "../providers/provider";
import { KeyHint, KeyHintSeparator } from "./key-hint";

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 120;

export default function Footer(
  props: Readonly<{ commandBarMode: () => CommandBarMode; filterActive?: boolean; compact?: boolean }>,
) {
  const t = useT();
  const { state } = useAppState();

  const isLoading = () => state.loading() || state.fetching() || state.detailLoading();

  const providerStatus = () => state.providerStatus();

  const loadingLabel = () => {
    if (isLoading()) return " loading";
    // providerStatus.kind === "loading" means a background CI fetch is in-flight.
    // Show the text regardless of which view is active — the spinner char is
    // already shown in this case, so the label should match to avoid the
    // visual inconsistency of a spinning braille with no accompanying text.
    if (providerStatus().kind === "loading") return " loading";
    return "";
  };

  // Animation frame counter, cycles while loading
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (isLoading() || providerStatus().kind === "loading") {
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
  const spinnerChar = () => (isLoading() || providerStatus().kind === "loading" ? SPINNER_FRAMES[frame()] : " ");
  const spinnerColor = () => t().accent;

  const enterAction = () => (state.detailFocused() ? state.detailCursorAction() : null);
  const nextProviderLabel = () => {
    getProviderRegistryVersion();
    const views = getEnabledProviderViews();
    if (views.length <= 1) return null;
    const next = nextProviderView(state.activeProviderView());
    if (next === state.activeProviderView()) return null;
    return providerDisplayName(next);
  };

  const mode = () => props.commandBarMode();

  const ancestryMode = () => state.ancestrySet() !== null;

  return (
    <>
      <box flexDirection="row" width="100%" height={1}>
        {/* Loading indicator — always present to avoid layout shift, left-aligned */}
        <text flexShrink={0} wrapMode="none" fg={spinnerColor()}>
          {spinnerChar()}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {loadingLabel()}
        </text>

        {/* Spacer pushes hints right */}
        <box flexGrow={1} />

        {/* ── Detail focused ───────────────────────────────────────────────── */}
        <Show when={state.detailFocused()}>
          <Show when={nextProviderLabel()}>
            <KeyHint key="tab" desc={` ${nextProviderLabel()}`} />
          </Show>
          <Show when={nextProviderLabel()}>
            <KeyHintSeparator />
          </Show>
          <Show when={enterAction()}>
            <KeyHint key="enter" desc={` ${enterAction()}`} />
          </Show>
          <Show when={enterAction()}>
            <KeyHintSeparator />
          </Show>
          <KeyHint key="esc" desc=" back" />
          <KeyHintSeparator />
          <KeyHint key="←/→" desc=" switch tab" />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc=" navigate" />
        </Show>

        {/* ── Input modes (command / search / path) ────────────────────────── */}
        <Show when={!state.detailFocused() && mode() !== "idle"}>
          <KeyHint key="enter" desc=" confirm" />
          <KeyHintSeparator />
          <KeyHint key="esc" desc=" cancel" />
          <KeyHintSeparator />
          <KeyHint key="shift ←/→" desc=" switch project" />
        </Show>

        {/* ── Graph idle ───────────────────────────────────────────────────── */}
        <Show when={!state.detailFocused() && mode() === "idle"}>
          {/* Ancestry mode active */}
          <Show when={ancestryMode()}>
            <KeyHint key="esc" desc=" clear" />
          </Show>
          <Show when={ancestryMode()}>
            <KeyHintSeparator />
          </Show>

          {/* No ancestry active */}
          <Show when={!ancestryMode()}>
            <Show when={props.filterActive}>
              <KeyHint key="esc" desc=" clear" />
            </Show>
            <Show when={props.filterActive}>
              <KeyHintSeparator />
            </Show>
          </Show>

          {/* Switch tab / show details — always shown in graph idle */}
          <Show when={nextProviderLabel()}>
            <KeyHint key="tab" desc={` ${nextProviderLabel()}`} />
          </Show>
          <Show when={nextProviderLabel()}>
            <KeyHintSeparator />
          </Show>
          <Show when={props.compact} fallback={<KeyHint key="←/→" desc=" switch tab" />}>
            <KeyHint key="enter" desc=" show details" />
          </Show>
          <KeyHintSeparator />
          <KeyHint key="shift ←/→" desc=" switch project" />
          <KeyHintSeparator />

          <KeyHint key="↑/↓" desc=" navigate" />
        </Show>
      </box>
      <box height={1} />
    </>
  );
}
