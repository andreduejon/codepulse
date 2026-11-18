import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { OpenShiftEvent, OpenShiftResource } from "../../../core/openshift/types";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";
import { shouldFollowOpenShiftLog } from "../../../core/openshift/watch";
import type { LogViewState } from "../../components/dialogs/log-view";
import { LogViewer, type LogViewerLine } from "../../components/dialogs/log-viewer";
import { useSystem } from "../../context/system";
import { BUSY } from "../../utils/busy-text";
import { stripTerminalControls } from "../../utils/terminal-text";
import { openShiftConsoleUrl } from "./console";
import {
  formatCachedWarnings,
  formatOpenShiftEvents,
  formatOpenShiftStatus,
  OPENSHIFT_EVENT_KINDS,
  OPENSHIFT_NO_EVENTS,
  type OpenShiftEventLine,
} from "./events";

interface OpenShiftResourceDialogProps {
  resource: OpenShiftResource;
  onClose: () => void;
  loadLog?: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  followLog?: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  loadObject?: (resource: OpenShiftResource, force?: boolean) => Promise<unknown>;
  /** Web console URL from the settings; `o` opens the resource there when it is set. */
  consoleUrl?: string;
  /** The events about the resource, for the events view (`c`). */
  loadEvents?: (resource: OpenShiftResource) => Promise<OpenShiftEvent[]>;
  /** The view it opens on (the Events tab opens the events); the log, or the object without one, by default. */
  initialView?: "events";
  /**
   * The resource is gone (its commit no longer has it): only its events, kept by the cluster for a while and by the
   * cache; no log, object or console page.
   */
  eventsOnly?: boolean;
  /** The warnings codepulse kept about the resource: the events view adds the ones the cluster no longer has. */
  savedWarnings?: () => readonly OpenShiftWarning[];
}

type ViewMode = "log" | "json" | "events";

/** A build only the cache has, whose log nobody opened while it existed: codepulse never got it. */
export const OPENSHIFT_NO_SAVED_LOG = "No saved log. OpenShift pruned the build before its log was opened.";

function resourceHasLog(resource: OpenShiftResource): boolean {
  return resource.kind === "Build" || resource.kind === "Pod";
}

export default function OpenShiftResourceDialog(props: Readonly<OpenShiftResourceDialogProps>) {
  /** The browser and the environment, through the app's system port. */
  const system = useSystem();
  const [viewMode, setViewMode] = createSignal<ViewMode>(
    untrack(() =>
      (props.initialView === "events" || props.eventsOnly) &&
      props.loadEvents &&
      OPENSHIFT_EVENT_KINDS.has(props.resource.kind)
        ? "events"
        : resourceHasLog(props.resource)
          ? "log"
          : "json",
    ),
  );
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
  const canLog = () => !props.eventsOnly && resourceHasLog(props.resource) && !!props.loadLog;
  /** Its object: what the events view's status comes from, and the JSON view. */
  const canObject = () => !props.eventsOnly && !!props.loadObject;
  const canEvents = () => !!props.loadEvents && OPENSHIFT_EVENT_KINDS.has(props.resource.kind);
  /** The views `c` cycles through, in order: log, object, events. */
  const viewModes = createMemo((): ViewMode[] => [
    ...(canLog() ? (["log"] as const) : []),
    ...(canObject() || !canEvents() ? (["json"] as const) : []),
    ...(canEvents() ? (["events"] as const) : []),
  ]);

  /** Set when the dialog closes: a read that answers after that shows nothing (its screen may be gone). */
  let closed = false;
  onCleanup(() => {
    closed = true;
  });

  const loadEvents = async () => {
    if (!props.loadEvents) return;
    setEventsLoading(true);
    setEventsError(null);
    try {
      const events = await props.loadEvents(props.resource);
      if (!closed) setEvents(events);
    } catch (error) {
      if (!closed) setEventsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!closed) setEventsLoading(false);
    }
  };

  const loadLog = async (force = false) => {
    if (!props.loadLog || !resourceHasLog(props.resource)) return;
    setLogLoading(true);
    setLogError(null);
    try {
      const text = await props.loadLog(props.resource, force);
      if (!closed) setLogText(text);
    } catch (error) {
      if (!closed) setLogError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!closed) setLogLoading(false);
    }
  };

  const loadObject = async (force = false) => {
    if (!props.loadObject || !canObject()) return;
    setObjectLoading(true);
    setObjectError(null);
    try {
      const object = await props.loadObject(props.resource, force);
      if (closed) return;
      setObjectValue(object);
      setObjectText(JSON.stringify(object, null, 2));
    } catch (error) {
      if (!closed) setObjectError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!closed) setObjectLoading(false);
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
        if (objectText() === null && !objectLoading() && canObject()) void loadObject();
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

  const statusLines = createMemo(() => formatOpenShiftStatus(props.resource.kind, objectValue()));
  /**
   * The kept warnings the cluster's events no longer have: once the events loaded, so none shows twice, or failed, when
   * they are all that is left.
   */
  const cachedLines = createMemo(() =>
    events() === null && !eventsError() ? [] : formatCachedWarnings(props.savedWarnings?.() ?? [], events() ?? []),
  );
  /** The view has more than the live events: with them failed or gone, a muted line says so instead of replacing it. */
  const hasMoreThanEvents = () => statusLines().length > 0 || cachedLines().length > 0;
  /** What the status says is wrong, then the events, then the cached warnings. */
  const eventLines = createMemo((): OpenShiftEventLine[] => {
    const list = formatOpenShiftEvents(events() ?? []);
    const status = statusLines();
    if (!hasMoreThanEvents()) return list;
    const error = eventsError();
    const live: OpenShiftEventLine[] = error
      ? [{ text: error, kind: "header" }]
      : (events() ?? []).length === 0
        ? [{ text: OPENSHIFT_NO_EVENTS, kind: "header" }]
        : list;
    return [
      ...(status.length > 0 ? [...status, { text: "", kind: "normal" as const }] : []),
      ...live,
      ...cachedLines(),
    ];
  });
  const warningCount = () => (events() ?? []).filter(event => event.type === "Warning").length;
  /** Events show warnings in the warning color and the header muted; log and object lines are plain. */
  const lines = createMemo((): LogViewerLine[] => {
    const mode = viewMode();
    if (mode === "events")
      return eventLines().map((line, index) => ({
        text: line.text,
        lineNo: index + 1,
        kind: line.kind === "warning" ? "warning" : line.kind === "header" ? "muted" : "normal",
      }));
    const text = mode === "log" ? stripTerminalControls(logText() ?? "") : (objectText() ?? "");
    return text.split("\n").map((line, index) => ({ text: line, lineNo: index + 1 }));
  });
  /** Loading, failed or empty: shown instead of numbered lines, the same way as the CI log dialog. */
  const viewState = (): LogViewState | null => {
    if (viewMode() === "log") {
      if (logLoading()) return { kind: "loading", text: BUSY.fetchingLog };
      const error = logError();
      if (error) return { kind: "error", title: "Failed to load log", message: error };
      if (!logText()?.trim())
        return { kind: "empty", text: props.resource.cacheOnly ? OPENSHIFT_NO_SAVED_LOG : "No log output." };
      return null;
    }
    if (viewMode() === "events") {
      if (eventsLoading() || objectLoading()) return { kind: "loading", text: BUSY.fetchingEvents };
      if (hasMoreThanEvents()) return null;
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

  /** `r` refreshes what is on screen: the object in JSON view, the log (restarting a follow) in log view. */
  const canRefresh = () => (viewMode() === "json" ? canObject() : viewMode() === "events" ? canEvents() : canLog());
  const refresh = () => {
    if (viewMode() === "events") {
      void loadEvents();
      if (canObject()) void loadObject(true);
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
    props.eventsOnly
      ? null
      : openShiftConsoleUrl(props.consoleUrl ?? "", { namespace: props.resource.namespace, resource: props.resource });
  const openConsole = () => system.openUrl(consolePage() ?? undefined);

  return (
    <LogViewer
      // Like the diff title: context (provider, then namespace, kind) goes first; the resource name shrinks last.
      title={() => [
        { text: "OpenShift", drop: 1 },
        { text: props.resource.kind, drop: 3 },
        { text: props.resource.namespace, drop: 2 },
        { text: props.resource.name, emphasis: true, primary: true },
        {
          text:
            viewMode() === "log"
              ? followEnded()
                ? "log ended"
                : "log"
              : viewMode() === "events"
                ? "events"
                : "object",
        },
        { text: warningCount() > 0 ? `${warningCount()} warning${warningCount() === 1 ? "" : "s"}` : "", drop: 4 },
      ]}
      lines={lines}
      state={viewState}
      searchPlaceholder={() =>
        viewMode() === "log" ? "Search log..." : viewMode() === "events" ? "Search events..." : "Search object..."
      }
      // Same words and order as the CI log and diff dialogs: search · view · wrap · refresh · open.
      actions={() => ({
        view: viewModes().length > 1 ? cycleViewMode : undefined,
        refresh: canRefresh() ? refresh : undefined,
        open: consolePage() ? openConsole : undefined,
      })}
      stickToBottom={() => viewMode() === "log"}
      // A log starts at its end; the other views stay where they are.
      scrollKey={() => [props.resource.id, viewMode()]}
      scrollStart={() => (viewMode() === "log" ? "bottom" : null)}
      onClose={props.onClose}
    />
  );
}
