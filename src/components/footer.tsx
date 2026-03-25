import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { useTheme } from "../context/theme";
import { useAppState } from "../context/state";

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 80;

export default function Footer() {
  const { theme } = useTheme();
  const t = () => theme();
  const { state } = useAppState();

  const isLoading = () => state.loading() || state.fetching() || state.detailLoading();

  // Animation frame counter, cycles while loading
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (isLoading()) {
      setFrame(0);
      if (!spinnerTimer) {
        spinnerTimer = setInterval(() => {
          setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
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

  const spinnerChar = () => SPINNER_FRAMES[frame()];

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
    >
      {/* Loading indicator — left-aligned, visible only while loading */}
      <Show when={isLoading()}>
        <text flexShrink={0} wrapMode="none" fg={t().accent}>
          {spinnerChar()}
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
