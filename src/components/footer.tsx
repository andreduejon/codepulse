import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { useTheme } from "../context/theme";
import { useAppState } from "../context/state";

/** Block fill characters for the breathing pulse animation. */
const PULSE_CHARS = ["\u2591", "\u2592", "\u2593", "\u2588", "\u2588", "\u2593", "\u2592", "\u2591", "\u2591", "\u2591"];
const PULSE_FRAME_MS = 100;
const PULSE_BLOCK_COUNT = 6;

export default function Footer() {
  const { theme } = useTheme();
  const t = () => theme();
  const { state } = useAppState();

  const isLoading = () => state.loading() || state.fetching() || state.detailLoading();

  // Animation frame counter (0..PULSE_CHARS.length-1), cycles while loading
  const [frame, setFrame] = createSignal(0);
  let pulseTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (isLoading()) {
      // Reset to start of cycle and begin ticking
      setFrame(0);
      if (!pulseTimer) {
        pulseTimer = setInterval(() => {
          setFrame((f) => (f + 1) % PULSE_CHARS.length);
        }, PULSE_FRAME_MS);
      }
    } else {
      // Stop the animation
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = null;
      }
    }
  });

  onCleanup(() => {
    if (pulseTimer) clearInterval(pulseTimer);
  });

  const pulseText = () => Array.from({ length: PULSE_BLOCK_COUNT }, () => PULSE_CHARS[frame()]).join(" ");

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
    >
      {/* Loading indicator — left-aligned, visible only while loading */}
      <Show when={isLoading()}>
        <text flexShrink={0} wrapMode="none" fg={t().accent}>
          {pulseText()}
        </text>
        <text flexShrink={0} wrapMode="none">{" "}</text>
      </Show>

      {/* Spacer pushes everything right */}
      <box flexGrow={1} />

      {/* Keyboard hints — right-aligned, separate <text> per color segment */}
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>{"\u2191/\u2193"}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" navigate  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>/</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" search  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>f</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" fetch  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>m</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" menu  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>?</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" help  "}</text>
      <text flexShrink={0} wrapMode="none" fg={t().foreground}>q</text>
      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" quit"}</text>
    </box>
  );
}
