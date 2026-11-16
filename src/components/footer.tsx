import type { BoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useAppState } from "../context/state";
import type { DashboardState } from "../dashboard/use-dashboard";
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";
import { useT } from "../hooks/use-t";
import { providerDisplayName } from "../providers/provider";
import { endTruncate } from "../utils/truncate";
import { fitHints, KeyHint, KeyHintSeparator, type RankedHint } from "./key-hint";

interface FooterHint extends RankedHint {
  disabled?: boolean;
  onClick?: () => void;
}

/** Full braille rotation spinner — 8 frames, smooth circular motion. */
const SPINNER_FRAMES = ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u283F", "\u28EF", "\u28F7"];
const SPINNER_FRAME_MS = 120;

/** How long work runs before the footer shows it as busy. */
const BUSY_SHOW_DELAY_MS = 500;

export default function Footer(
  props: Readonly<{
    commandBarMode: () => CommandBarMode;
    filterActive?: boolean;
    compact?: boolean;
    onOpenDetails?: () => void;
    onConfirm?: () => void;
    onClose?: () => void;
    mouseEnabled?: boolean;
    /** While the dashboard shows: its keys, and its reading as work in progress. */
    dashboard?: DashboardState;
    /** The dashboard's `r`: fetch its providers again and read its events (only reading without it). */
    onDashboardRefresh?: () => void;
    /** How long work runs before the spinner and its label show (tests: 0). */
    busyDelayMs?: number;
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
  const dashboardShown = () => state.activeProviderView() === "dashboard" && !!props.dashboard;
  const dashboardReading = () => dashboardShown() && !!props.dashboard?.loading();
  const busy = () =>
    dashboardReading() ||
    state.loading() ||
    state.fetching() ||
    state.detailLoading() ||
    providerStatus().kind === "loading" ||
    activities().length > 0;

  /**
   * Shown once something has been busy for a moment: background work that ends sooner (an automatic refresh, a quick
   * read) never makes the footer blink. Gone as soon as nothing is busy. A memo, so the wait restarts only when busy
   * flips, not each time its label changes.
   */
  const isBusy = createMemo(busy);
  const [shownBusy, setShownBusy] = createSignal(false);
  createEffect(() => {
    if (!isBusy()) {
      setShownBusy(false);
      return;
    }
    const delay = props.busyDelayMs ?? BUSY_SHOW_DELAY_MS;
    if (delay <= 0) {
      setShownBusy(true);
      return;
    }
    const timer = setTimeout(() => setShownBusy(true), delay);
    onCleanup(() => clearTimeout(timer));
  });

  const [labelWidth, setLabelWidth] = createSignal(Number.POSITIVE_INFINITY);
  const loadingLabel = () => {
    const git = gitActivity();
    const parts = [
      ...(dashboardReading() ? ["Dashboard reading"] : []),
      ...(git ? [git] : []),
      ...(genericLoading() ? ["loading"] : []),
      ...activities(),
    ];
    return parts.length > 0 ? ` ${parts.join(" · ")}` : "";
  };

  // Animation frame counter, cycles while loading
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    if (shownBusy()) {
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
  const spinnerChar = () => (shownBusy() ? SPINNER_FRAMES[frame()] : " ");
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

  const [footerWidth, setFooterWidth] = createSignal(Number.POSITIVE_INFINITY);
  const click = (handler?: () => void) => (props.mouseEnabled === false ? undefined : handler);
  /** The hints of the current mode, in display order. `rank`: 1 is needed most, 6 least. */
  const hints = (): FooterHint[] => {
    const next = nextProviderLabel();
    const viewHint = next ? [{ key: "tab", desc: ` ${next}`, rank: 5 }] : [];
    if (state.detailFocused()) {
      const action = enterAction();
      const shortcut = state.detailCursorShortcut();
      return [
        ...viewHint,
        ...(action
          ? [
              {
                key: "enter",
                desc: ` ${action}`,
                rank: 1,
                disabled: !state.selectedCommit() || !action,
                onClick: click(props.onConfirm),
              },
            ]
          : []),
        ...(shortcut ? [{ key: shortcut.key, desc: ` ${shortcut.desc}`, rank: 2 }] : []),
        { key: "esc", desc: " back", rank: 2, onClick: click(props.onClose) },
        { key: "←/→", desc: " switch tab", rank: 4 },
        { key: "↑/↓", desc: " navigate", rank: 3 },
      ];
    }
    const dashboard = props.dashboard;
    if (dashboardShown() && dashboard && mode() === "idle") {
      const selected = dashboard.rows()[dashboard.cursor()];
      return [
        ...viewHint,
        ...(selected?.kind === "event"
          ? [
              {
                key: "enter",
                desc: props.compact ? " details" : ` show in ${providerDisplayName(selected.event.source)}`,
                rank: 1,
                onClick: click(props.onConfirm),
              },
              // Beside the events, the event's tabs (its provider's, Info) take the keyboard.
              ...(!props.compact ? [{ key: "→", desc: " details", rank: 2 }] : []),
            ]
          : []),
        ...(dashboard.selected()?.url ? [{ key: "o", desc: " open", rank: 2 }] : []),
        {
          key: "r",
          desc: " refresh",
          rank: 5,
          onClick: click(props.onDashboardRefresh ?? (() => void dashboard.reload())),
        },
        { key: "↑/↓", desc: " navigate", rank: 3 },
      ];
    }
    if (mode() !== "idle")
      return [
        { key: "enter", desc: " confirm", rank: 1, onClick: click(props.onConfirm) },
        { key: "esc", desc: " cancel", rank: 1, onClick: click(props.onClose) },
        { key: "shift ←/→", desc: " switch project", rank: 6 },
      ];
    const action = enterAction();
    return [
      ...(action ? [{ key: "enter", desc: ` ${action}`, rank: 2 }] : []),
      ...(ancestryMode() || props.filterActive
        ? [{ key: "esc", desc: " clear", rank: 2, onClick: click(props.onClose) }]
        : []),
      ...viewHint,
      {
        key: props.compact ? "enter" : "enter/→",
        desc: props.compact ? " details" : " show details",
        rank: 1,
        disabled: !state.selectedCommit(),
        onClick: click(props.onOpenDetails),
      },
      { key: "shift ←/→", desc: " switch project", rank: 6 },
      { key: "↑/↓", desc: " navigate", rank: 3 },
    ];
  };
  /** Hints that fit beside the spinner. */
  const shownHints = createMemo(() => fitHints(hints(), footerWidth() - 1));

  return (
    <>
      <box
        flexDirection="row"
        width="100%"
        height={1}
        onSizeChange={function (this: BoxRenderable) {
          setFooterWidth(this.width);
        }}
      >
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
            {shownBusy() ? endTruncate(loadingLabel(), Math.max(0, labelWidth() - 1)) : ""}
          </text>
        </box>

        {/* Key hints: whole hints only, the least needed left out first when the footer is narrow. */}
        <For each={shownHints()}>
          {(hint, index) => (
            <>
              <Show when={index() > 0}>
                <KeyHintSeparator />
              </Show>
              <KeyHint key={hint.key} desc={hint.desc} disabled={hint.disabled} onClick={hint.onClick} />
            </>
          )}
        </For>
      </box>
      <box height={1} />
    </>
  );
}
