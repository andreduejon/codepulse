import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import { highlightHits, LineNumber, LogSearchRow, useLogSearch } from "../../components/dialogs/log-search";
import { handleLogScrollKey, type LogViewState, LogViewStatus } from "../../components/dialogs/log-view";
import { fitTitleSegments } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { stripTerminalControls } from "../../utils/terminal-text";
import type { OpenShiftResource } from "./types";
import { shouldFollowOpenShiftLog } from "./watch";

interface OpenShiftResourceDialogProps {
  resource: OpenShiftResource;
  onClose: () => void;
  loadLog?: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  followLog?: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  loadObject?: (resource: OpenShiftResource, force?: boolean) => Promise<unknown>;
  /** The search row starts or stops owning Esc (see `useLogSearch`). */
  onSearchActive?: (active: boolean) => void;
}

type ViewMode = "log" | "json";

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
  const [objectError, setObjectError] = createSignal<string | null>(null);
  const [objectLoading, setObjectLoading] = createSignal(false);
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const dialogFrame = createMemo(() => getStandardDialogFrame(dimensions()));
  const canLog = () => resourceHasLog(props.resource) && !!props.loadLog;

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
      setObjectText(JSON.stringify(await props.loadObject(props.resource, force), null, 2));
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

  createEffect(() => {
    props.resource.id;
    if (viewMode() !== "log") return;
    queueMicrotask(() => scrollboxRef?.scrollTo(Infinity));
  });

  const lines = createMemo(() =>
    viewMode() === "log" ? stripTerminalControls(logText() ?? "").split("\n") : (objectText() ?? "").split("\n"),
  );
  /** Loading, failed or empty: shown instead of numbered lines, the same way as the CI log dialog. */
  const viewState = (): LogViewState | null => {
    if (viewMode() === "log") {
      if (logLoading()) return { kind: "loading", text: BUSY.fetchingLog };
      const error = logError();
      if (error) return { kind: "error", title: "Failed to load log", message: error };
      if (!logText()?.trim()) return { kind: "empty", text: "No log output." };
      return null;
    }
    if (objectLoading()) return { kind: "loading", text: BUSY.fetchingObject };
    const error = objectError();
    if (error) return { kind: "error", title: "Failed to load object", message: error };
    return null;
  };
  const lineNoWidth = createMemo(() => lines().length.toString().length);
  const lineRefs: Renderable[] = [];
  const search = useLogSearch({
    texts: lines,
    rowAt: index => lineRefs[index],
    scrollbox: () => scrollboxRef,
    onActiveChange: active => props.onSearchActive?.(active),
  });
  const title = createMemo(() => {
    const mode = viewMode() === "log" ? (followEnded() ? "log ended" : "log") : "object";
    // Like the diff title: context (provider, then namespace, kind) goes first; the resource name shrinks last.
    const segments = fitTitleSegments(
      [
        { text: "OpenShift", drop: 1 },
        { text: props.resource.kind, drop: 3 },
        { text: props.resource.namespace, drop: 2 },
        { text: props.resource.name, emphasis: true, primary: true },
        { text: mode },
      ],
      dialogFrame().width,
    );
    return <DialogTitle segments={segments} />;
  });

  const toggleWrap = () => setWrapEnabled(value => !value);
  /** `r` refreshes what is on screen: the object in JSON view, the log (restarting a follow) in log view. */
  const canRefresh = () => (viewMode() === "json" ? !!props.loadObject : canLog());
  const refresh = () => {
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
    if (!canLog()) return;
    setViewMode(current => (current === "log" ? "json" : "log"));
  };

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
    } else if (e.name === "c" && canLog()) {
      e.preventDefault();
      cycleViewMode();
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
                      <text wrapMode={wrapEnabled() ? "word" : "none"} fg={t().foreground}>
                        {highlightHits(line, search.term(), { fg: t().background, bg: t().accent })}
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
        <LogSearchRow search={search} placeholder={viewMode() === "log" ? "Search log..." : "Search object..."} />
        <DialogFooter>
          {/* Same words and order as the CI log and diff dialogs: search · view · wrap · refresh. */}
          <Show
            when={search.term()}
            fallback={<KeyHint key="/" desc=" search" onClick={() => search.setEditing(true)} />}
          >
            <KeyHint key="n/N" desc=" next/prev" onClick={() => search.step(1)} />
          </Show>
          {canLog() ? (
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
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
