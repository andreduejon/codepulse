import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import { getDialogTitleContentWidth, middleTruncate, TITLE_SEP } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import { useT } from "../../hooks/use-t";
import type { OpenShiftResource } from "./types";
import { shouldFollowOpenShiftLog } from "./watch";

interface OpenShiftResourceDialogProps {
  resource: OpenShiftResource;
  onClose: () => void;
  loadLog?: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  followLog?: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  loadObject?: (resource: OpenShiftResource) => Promise<unknown>;
}

const SCROLL_JUMP = 10;
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

  const loadObject = async () => {
    if (!props.loadObject) return;
    setObjectLoading(true);
    setObjectError(null);
    try {
      setObjectText(JSON.stringify(await props.loadObject(props.resource), null, 2));
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

  const lines = createMemo(() => {
    if (viewMode() === "log") {
      if (logLoading()) return ["loading..."];
      if (logError()) return [logError() ?? ""];
      return (logText() ?? "").split("\n");
    }
    if (objectLoading()) return ["loading..."];
    if (objectError()) return [objectError() ?? ""];
    return (objectText() ?? "").split("\n");
  });
  const lineNoWidth = createMemo(() => lines().length.toString().length);
  const title = createMemo(() => {
    const mode = viewMode() === "log" ? (followEnded() ? "log ended" : "log") : "object";
    const fixed = ["OpenShift", props.resource.kind, props.resource.namespace, mode].join(TITLE_SEP);
    const available = Math.max(8, getDialogTitleContentWidth(dialogFrame().width) - fixed.length - TITLE_SEP.length);
    return (
      <DialogTitle
        segments={[
          { text: "OpenShift" },
          { text: props.resource.kind },
          { text: props.resource.namespace },
          { text: middleTruncate(props.resource.name, available), emphasis: true },
          { text: mode },
        ]}
      />
    );
  });

  const toggleWrap = () => setWrapEnabled(value => !value);
  const refreshLog = () => {
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
    if (e.name === "q") {
      e.preventDefault();
      renderer.destroy();
    } else if (e.name === "escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.name === "up" || e.name === "k") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? -SCROLL_JUMP : -1, "absolute");
    } else if (e.name === "down" || e.name === "j") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? SCROLL_JUMP : 1, "absolute");
    } else if (e.name === "g") {
      e.preventDefault();
      scrollboxRef?.scrollTo(e.shift ? Infinity : 0);
    } else if (e.name === "w") {
      e.preventDefault();
      toggleWrap();
    } else if (e.name === "r" && canLog()) {
      e.preventDefault();
      refreshLog();
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
          <box flexDirection="column" width="100%" paddingX={4}>
            <For each={lines()}>
              {(line, index) => (
                <box flexDirection="row" width="100%">
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {`${String(index() + 1).padStart(lineNoWidth())}  `}
                  </text>
                  <text
                    wrapMode={wrapEnabled() ? "word" : "none"}
                    fg={(viewMode() === "log" ? logError() : objectError()) ? t().error : t().foreground}
                  >
                    {line}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
        <DialogFooter>
          <KeyHint key="↑/↓" desc=" scroll" />
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " disable wrap" : " enable wrap"} onClick={toggleWrap} />
          {canLog() ? (
            <>
              <KeyHintSeparator />
              <KeyHint key="c" desc=" cycle view mode" disabled={!canLog()} onClick={cycleViewMode} />
              <KeyHintSeparator />
              <KeyHint key="r" desc=" refresh log" disabled={!canLog()} onClick={refreshLog} />
            </>
          ) : null}
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
