import type { BoxRenderable } from "@opentui/core";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { providerDisplayName } from "../providers/provider";
import { endTruncate } from "../utils/truncate";
import { KeyHint, KeyHintSeparator } from "./key-hint";

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 120;

export default function Footer(
  props: Readonly<{
    commandBarMode: () => CommandBarMode;
    filterActive?: boolean;
    compact?: boolean;
    onOpenDetails?: () => void;
    onConfirm?: () => void;
    onClose?: () => void;
    mouseEnabled?: boolean;
  }>,
) {
  const t = useT();
  const { state } = useAppState();

  /** Git's own work by name; reading a commit's details is too quick for words, so it only spins. */
  const gitActivity = () =>
    state.fetching() && !state.fetchingHistory()
      ? "Git fetching"
      : state.loading() || state.fetchingHistory()
        ? "Git reading log"
        : null;

  const providerStatus = () => state.providerStatus();
  /** Providers naming their own work (`Snyk scanning`), in every view. */
  const activities = () => {
    state.providers.getVersion();
    return state.providers.getEnabledViews().flatMap(view => {
      const provider = state.providers.get(view);
      const activity = provider?.activity?.();
      return provider && activity ? [`${provider.displayName} ${activity}`] : [];
    });
  };
  /** Generic `loading` only for a provider that cannot name its work; the others say `fetching` or `scanning`. */
  const genericLoading = () =>
    providerStatus().kind === "loading" && !state.providers.get(state.activeProviderView())?.activity;
  const busy = () =>
    state.loading() ||
    state.fetching() ||
    state.detailLoading() ||
    providerStatus().kind === "loading" ||
    activities().length > 0;

  const [labelWidth, setLabelWidth] = createSignal(Number.POSITIVE_INFINITY);
  const loadingLabel = () => {
    const git = gitActivity();
    const parts = [...(git ? [git] : []), ...(genericLoading() ? ["loading"] : []), ...activities()];
    return parts.length > 0 ? ` ${parts.join(" · ")}` : "";
  };

  // Animation frame counter, cycles while loading
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (busy()) {
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
  const spinnerChar = () => (busy() ? SPINNER_FRAMES[frame()] : " ");
  const spinnerColor = () => t().accent;

  const enterAction = () => {
    return state.detailFocused() ? state.detailCursorAction() : null;
  };
  const nextProviderLabel = () => {
    state.providers.getVersion();
    const views = state.providers.getEnabledViews();
    if (views.length <= 1) return null;
    const next = state.providers.nextView(state.activeProviderView());
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
        {/* Takes the space left of the hints (pushing them right) and cuts its label at the end to fit, so several
            providers at once never push the key hints off a narrow footer. */}
        <box
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          onSizeChange={function (this: BoxRenderable) {
            setLabelWidth(this.width);
          }}
        >
          <text wrapMode="none" fg={t().foregroundMuted}>
            {endTruncate(loadingLabel(), Math.max(0, labelWidth() - 1))}
          </text>
        </box>

        {/* ── Detail focused ───────────────────────────────────────────────── */}
        <Show when={state.detailFocused()}>
          <Show when={nextProviderLabel()}>
            <KeyHint key="tab" desc={` ${nextProviderLabel()}`} />
          </Show>
          <Show when={nextProviderLabel()}>
            <KeyHintSeparator />
          </Show>
          <Show when={enterAction()}>
            <KeyHint
              key="enter"
              desc={` ${enterAction()}`}
              disabled={!state.selectedCommit() || !enterAction()}
              onClick={props.mouseEnabled === false ? undefined : props.onConfirm}
            />
          </Show>
          <Show when={enterAction()}>
            <KeyHintSeparator />
          </Show>
          <Show when={state.detailCursorShortcut()}>
            {shortcut => (
              <>
                <KeyHint key={shortcut().key} desc={` ${shortcut().desc}`} />
                <KeyHintSeparator />
              </>
            )}
          </Show>
          <KeyHint key="esc" desc=" back" onClick={props.mouseEnabled === false ? undefined : props.onClose} />
          <KeyHintSeparator />
          <KeyHint key="←/→" desc=" switch tab" />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc=" navigate" />
        </Show>

        {/* ── Input modes (command / search / path) ────────────────────────── */}
        <Show when={!state.detailFocused() && mode() !== "idle"}>
          <KeyHint key="enter" desc=" confirm" onClick={props.mouseEnabled === false ? undefined : props.onConfirm} />
          <KeyHintSeparator />
          <KeyHint key="esc" desc=" cancel" onClick={props.mouseEnabled === false ? undefined : props.onClose} />
          <KeyHintSeparator />
          <KeyHint key="shift ←/→" desc=" switch project" />
        </Show>

        {/* ── Graph idle ───────────────────────────────────────────────────── */}
        <Show when={!state.detailFocused() && mode() === "idle"}>
          <Show when={enterAction()}>
            <KeyHint key="enter" desc={` ${enterAction()}`} />
            <KeyHintSeparator />
          </Show>
          {/* Ancestry mode active */}
          <Show when={ancestryMode()}>
            <KeyHint key="esc" desc=" clear" onClick={props.mouseEnabled === false ? undefined : props.onClose} />
          </Show>
          <Show when={ancestryMode()}>
            <KeyHintSeparator />
          </Show>

          {/* No ancestry active */}
          <Show when={!ancestryMode()}>
            <Show when={props.filterActive}>
              <KeyHint key="esc" desc=" clear" onClick={props.mouseEnabled === false ? undefined : props.onClose} />
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
          <KeyHint
            key={props.compact ? "enter" : "enter/→"}
            desc={props.compact ? " details" : " show details"}
            disabled={!state.selectedCommit()}
            onClick={props.mouseEnabled === false ? undefined : props.onOpenDetails}
          />
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
