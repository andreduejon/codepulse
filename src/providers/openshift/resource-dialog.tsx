import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import {
  highlightHits,
  LineNumber,
  LogSearchRow,
  useLogSearch,
  useSidewaysReveal,
  useVisibleNumberWidth,
} from "../../components/dialogs/log-search";
import { handleLogScrollKey, type LogViewState, LogViewStatus } from "../../components/dialogs/log-view";
import { fitTitleSegments } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { openUrl } from "../../utils/open-url";
import { stripTerminalControls } from "../../utils/terminal-text";
import { openShiftConsoleUrl } from "./console";
import {
  formatOpenShiftEvents,
  formatOpenShiftStatus,
  OPENSHIFT_EVENT_KINDS,
  OPENSHIFT_NO_EVENTS,
  type OpenShiftEventLine,
} from "./events";
import type { OpenShiftEvent, OpenShiftResource } from "./types";
import { shouldFollowOpenShiftLog } from "./watch";

interface OpenShiftResourceDialogProps {
  resource: OpenShiftResource;
  onClose: () => void;
  loadLog?: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  followLog?: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  loadObject?: (resource: OpenShiftResource, force?: boolean) => Promise<unknown>;
  /** The search row starts or stops owning Esc (see `useLogSearch`). */
  onSearchActive?: (active: boolean) => void;
  /** Web console URL from the settings; `o` opens the resource there when it is set. */
  consoleUrl?: string;
  /** The events about the resource, for the events view (`c`). */
  loadEvents?: (resource: OpenShiftResource) => Promise<OpenShiftEvent[]>;
}

type ViewMode = "log" | "json" | "events";

function resourceHasLog(resource: OpenShiftResource): boolean {
  return resource.kind === "Build" || resource.kind === "Pod";
}

export default function OpenShiftResourceDialog(props: Readonly<OpenShiftResourceDialogProps>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [wrapEnabled, setWrapEnabled] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<ViewMode>(resourceHasLog(props.resource) ? "log" : "json");
  const [logText, setLogText] = createSignal<string | null>(null);
  const [logError, setLogError] = createSignal<string | null>(null);
  const [logLoading, setLogLoading] = createSignal(false);
  const [followNonce, setFollowNonce] = createSignal(0);
  const [followEnded, setFollowEnded] = createSignal(false);
  const [objectText, setObjectText] = createSignal<string | null>(null);
  /** The loaded object itself: the events view reads what its status says is wrong. */
  const [objectValue, setObjectValue] = createSignal<unknown>(null);
  const [objectError, setObjectError] = createSignal<string | null>(null);
  const [objectLoading, setObjectLoading] = createSignal(false);
  const [events, setEvents] = createSignal<OpenShiftEvent[] | null>(null);
  const [eventsError, setEventsError] = createSignal<string | null>(null);
  const [eventsLoading, setEventsLoading] = createSignal(false);
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const dialogFrame = createMemo(() => getStandardDialogFrame(dimensions()));
  const canLog = () => resourceHasLog(props.resource) && !!props.loadLog;
  const canEvents = () => !!props.loadEvents && OPENSHIFT_EVENT_KINDS.has(props.resource.kind);
  /** The views `c` cycles through, in order: log, object, events. */
  const viewModes = createMemo((): ViewMode[] => [
    ...(canLog() ? (["log"] as const) : []),
    "json",
    ...(canEvents() ? (["events"] as const) : []),
  ]);

  const loadEvents = async () => {
    if (!props.loadEvents) return;
    setEventsLoading(true);
    setEventsError(null);
    try {
      setEvents(await props.loadEvents(props.resource));
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : String(error));
    } finally {
      setEventsLoading(false);
    }
  };

  const loadLog = async (force = false) => {
    if (!props.loadLog || !resourceHasLog(props.resource)) return;
    setLogLoading(true);
    setLogError(null);
    try {
      setLogText(await props.loadLog(props.resource, force));
    } catch (error) {
      setLogError(error instanceof Error ? error.message : String(error));
    } finally {
      setLogLoading(false);
    }
  };

  const loadObject = async (force = false) => {
    if (!props.loadObject) return;
    setObjectLoading(true);
    setObjectError(null);
    try {
      const object = await props.loadObject(props.resource, force);
      setObjectValue(object);
      setObjectText(JSON.stringify(object, null, 2));
    } catch (error) {
      setObjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setObjectLoading(false);
    }
  };

  createEffect(() => {
    const resource = props.resource;
    const mode = viewMode();
    followNonce();
    if (mode === "json") {
      void loadObject();
      return;
    }
    if (mode === "events") {
      // The events came when the dialog opened (for the title's count); the status above them is in the object.
      untrack(() => {
        if (events() === null && !eventsLoading() && !eventsError()) void loadEvents();
        if (objectText() === null && !objectLoading()) void loadObject();
      });
      return;
    }
    if (!canLog()) return;
    if (shouldFollowOpenShiftLog(resource) && props.followLog) {
      const ctrl = new AbortController();
      setFollowEnded(false);
      setLogLoading(true);
      setLogError(null);
      setLogText("");
      void props
        .followLog(resource, ctrl.signal, text => {
          setLogLoading(false);
          setLogText(text);
        })
        .then(() => {
          if (ctrl.signal.aborted) return;
          setLogLoading(false);
          setFollowEnded(true);
          if (resource.kind === "Build") void loadLog(false);
        })
        .catch(error => {
          if (ctrl.signal.aborted) return;
          setLogLoading(false);
          setLogError(error instanceof Error ? error.message : String(error));
        });
      onCleanup(() => ctrl.abort());
      return;
    }
    void loadLog(false);
  });

  // Events load as the dialog opens, so the title can say there are warnings before you switch to them.
  createEffect(() => {
    props.resource.id;
    if (canEvents()) untrack(() => void loadEvents());
  });

  createEffect(() => {
    props.resource.id;
    if (viewMode() !== "log") return;
    queueMicrotask(() => scrollboxRef?.scrollTo(Infinity));
  });

  const statusLines = createMemo(() => formatOpenShiftStatus(props.resource.kind, objectValue()));
  /**
   * What the status says is wrong, then the events. With a status to show, events that failed to load or are gone
   * become a muted line below it instead of replacing the view.
   */
  const eventLines = createMemo((): OpenShiftEventLine[] => {
    const list = formatOpenShiftEvents(events() ?? []);
    const status = statusLines();
    if (status.length === 0) return list;
    const error = eventsError();
    const below: OpenShiftEventLine[] = error
      ? [{ text: error, kind: "header" }]
      : (events() ?? []).length === 0
        ? [{ text: OPENSHIFT_NO_EVENTS, kind: "header" }]
        : list;
    return [...status, { text: "", kind: "normal" }, ...below];
  });
  const warningCount = () => (events() ?? []).filter(event => event.type === "Warning").length;
  const lines = createMemo(() => {
    const mode = viewMode();
    if (mode === "log") return stripTerminalControls(logText() ?? "").split("\n");
    if (mode === "events") return eventLines().map(line => line.text);
    return (objectText() ?? "").split("\n");
  });
  /** Events show warnings in the warning color and the header muted; log and object lines are plain. */
  const lineColor = (index: number) => {
    if (viewMode() !== "events") return t().foreground;
    const kind = eventLines()[index]?.kind;
    return kind === "warning" ? t().warning : kind === "header" ? t().foregroundMuted : t().foreground;
  };
  /** Loading, failed or empty: shown instead of numbered lines, the same way as the CI log dialog. */
  const viewState = (): LogViewState | null => {
    if (viewMode() === "log") {
      if (logLoading()) return { kind: "loading", text: BUSY.fetchingLog };
      const error = logError();
      if (error) return { kind: "error", title: "Failed to load log", message: error };
      if (!logText()?.trim()) return { kind: "empty", text: "No log output." };
      return null;
    }
    if (viewMode() === "events") {
      if (eventsLoading() || objectLoading()) return { kind: "loading", text: BUSY.fetchingEvents };
      if (statusLines().length > 0) return null;
      const error = eventsError();
      if (error) return { kind: "error", title: "Failed to load events", message: error };
      if ((events() ?? []).length === 0) return { kind: "empty", text: OPENSHIFT_NO_EVENTS };
      return null;
    }
    if (objectLoading()) return { kind: "loading", text: BUSY.fetchingObject };
    const error = objectError();
    if (error) return { kind: "error", title: "Failed to load object", message: error };
    return null;
  };
  const lineRefs: Renderable[] = [];
  const lineNoWidth = useVisibleNumberWidth({
    scrollbox: () => scrollboxRef,
    rowAt: index => lineRefs[index],
    lines,
    numberAt: index => index + 1,
    layoutKey: wrapEnabled,
  });
  const search = useLogSearch({
    texts: lines,
    rowAt: index => lineRefs[index],
    scrollbox: () => scrollboxRef,
    onActiveChange: active => props.onSearchActive?.(active),
  });
  // Inner width: the dialog's frame (1) and padding (4) on both sides, then the line numbers and their gap.
  const reveal = useSidewaysReveal({
    search,
    texts: lines,
    wrap: wrapEnabled,
    width: () => dialogFrame().width - 10 - (lineNoWidth() + 2),
  });
  const title = createMemo(() => {
    const mode =
      viewMode() === "log" ? (followEnded() ? "log ended" : "log") : viewMode() === "events" ? "events" : "object";
    // Like the diff title: context (provider, then namespace, kind) goes first; the resource name shrinks last.
    const segments = fitTitleSegments(
      [
        { text: "OpenShift", drop: 1 },
        { text: props.resource.kind, drop: 3 },
        { text: props.resource.namespace, drop: 2 },
        { text: props.resource.name, emphasis: true, primary: true },
        { text: mode },
        { text: warningCount() > 0 ? `${warningCount()} warning${warningCount() === 1 ? "" : "s"}` : "", drop: 4 },
      ],
      dialogFrame().width,
    );
    return <DialogTitle segments={segments} />;
  });

  const toggleWrap = () => setWrapEnabled(value => !value);
  /** `r` refreshes what is on screen: the object in JSON view, the log (restarting a follow) in log view. */
  const canRefresh = () =>
    viewMode() === "json" ? !!props.loadObject : viewMode() === "events" ? canEvents() : canLog();
  const refresh = () => {
    if (viewMode() === "events") {
      void loadEvents();
      if (props.loadObject) void loadObject(true);
      return;
    }
    if (viewMode() === "json") {
      // `r` asks the API: the embedded object is the snapshot from when the resource was listed.
      if (props.loadObject) void loadObject(true);
      return;
    }
    if (!canLog()) return;
    if (shouldFollowOpenShiftLog(props.resource) && props.followLog) setFollowNonce(value => value + 1);
    else void loadLog(true);
  };
  const cycleViewMode = () => {
    const modes = viewModes();
    if (modes.length < 2) return;
    setViewMode(current => modes[(modes.indexOf(current) + 1) % modes.length] ?? modes[0]);
  };

  const consolePage = () =>
    openShiftConsoleUrl(props.consoleUrl ?? "", { namespace: props.resource.namespace, resource: props.resource });
  const openConsole = () => openUrl(consolePage() ?? undefined);

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (search.handleKey(e)) return;
    if (handleLogScrollKey(e, scrollboxRef, dialogFrame().height - 6)) {
      e.preventDefault();
      return;
    }
    if (e.name === "q") {
      e.preventDefault();
      renderer.destroy();
    } else if (e.name === "escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.name === "w") {
      e.preventDefault();
      toggleWrap();
    } else if (e.name === "r" && canRefresh()) {
      e.preventDefault();
      refresh();
    } else if (e.name === "c" && viewModes().length > 1) {
      e.preventDefault();
      cycleViewMode();
    } else if (e.name === "o" && consolePage()) {
      e.preventDefault();
      openConsole();
    }
  });

  return (
    <DialogOverlay align="top" topOffset={2}>
      <box
        width={dialogFrame().width}
        height={dialogFrame().height}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={title()} onClose={props.onClose} />
        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          stickyScroll={viewMode() === "log"}
          stickyStart={viewMode() === "log" ? "bottom" : undefined}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" width="100%" paddingX={viewState()?.kind === "error" ? 0 : 4}>
            <Show
              when={viewState()}
              fallback={
                <For each={lines()}>
                  {(line, index) => (
                    <box
                      ref={(element: Renderable) => {
                        lineRefs[index()] = element;
                      }}
                      flexDirection="row"
                      width="100%"
                    >
                      <LineNumber
                        text={String(index() + 1).padStart(lineNoWidth())}
                        current={search.current() === index()}
                      />
                      <text wrapMode={wrapEnabled() ? "word" : "none"} fg={lineColor(index())}>
                        {highlightHits(reveal(line), search.term(), { fg: t().background, bg: t().accent })}
                      </text>
                    </box>
                  )}
                </For>
              }
            >
              {state => <LogViewStatus state={state()} />}
            </Show>
          </box>
        </scrollbox>
        <LogSearchRow
          search={search}
          placeholder={
            viewMode() === "log" ? "Search log..." : viewMode() === "events" ? "Search events..." : "Search object..."
          }
        />
        <DialogFooter>
          {/* Same words and order as the CI log and diff dialogs: search · view · wrap · refresh. */}
          <Show
            when={search.term()}
            fallback={<KeyHint key="/" desc=" search" onClick={() => search.setEditing(true)} />}
          >
            <KeyHint key="n/N" desc=" next/previous" onClick={() => search.step(1)} />
          </Show>
          {viewModes().length > 1 ? (
            <>
              <KeyHintSeparator />
              <KeyHint key="c" desc=" view" onClick={cycleViewMode} />
            </>
          ) : null}
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " nowrap" : " wrap"} onClick={toggleWrap} />
          {canRefresh() ? (
            <>
              <KeyHintSeparator />
              <KeyHint key="r" desc=" refresh" onClick={refresh} />
            </>
          ) : null}
          <Show when={consolePage()}>
            <KeyHintSeparator />
            <KeyHint key="o" desc=" open" onClick={openConsole} />
          </Show>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
