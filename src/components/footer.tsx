import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 120;

export default function Footer(
  props: Readonly<{ searchFocused?: boolean; filterActive?: boolean; compact?: boolean }>,
) {
  const { theme } = useTheme();
  const t = () => theme();
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

        {/* Keyboard hints — context-dependent on search focus state */}
        <Show
          when={!props.searchFocused}
          fallback={
            <>
              <text flexShrink={0} wrapMode="none" fg={t().foreground}>
                enter
              </text>
              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                {" confirm  "}
              </text>
              <text flexShrink={0} wrapMode="none" fg={t().foreground}>
                esc
              </text>
              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                {" cancel"}
              </text>
            </>
          }
        >
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {enterAction() ? "enter" : ""}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {enterAction() ? ` ${enterAction()}  ` : ""}
          </text>
          <Show when={state.detailFocused()}>
            <text flexShrink={0} wrapMode="none" fg={t().foreground}>
              esc
            </text>
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {" back  "}
            </text>
          </Show>
          <Show when={props.filterActive && !state.detailFocused()}>
            <text flexShrink={0} wrapMode="none" fg={t().foreground}>
              esc
            </text>
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {" clear  "}
            </text>
          </Show>
          <Show
            when={!props.compact}
            fallback={
              <>
                <text flexShrink={0} wrapMode="none" fg={t().foreground}>
                  enter
                </text>
                <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                  {" show details  "}
                </text>
              </>
            }
          >
            <text flexShrink={0} wrapMode="none" fg={t().foreground}>
              {"\u2190/\u2192"}
            </text>
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {" switch tab  "}
            </text>
          </Show>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"\u2191/\u2193"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" navigate  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            /
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" search  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            m
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" menu  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            ?
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" help"}
          </text>
        </Show>
      </box>
      <box height={1} />
    </>
  );
}
