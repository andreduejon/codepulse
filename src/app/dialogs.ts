/**
 * The dialog host: which dialog is open and what it shows (a file's diff, a job's log, an OpenShift resource), opening
 * them, and where closing one goes back to. In the compact layout the details are a dialog too: a dialog opened from
 * them returns to them, and resizing across the side panel's width moves the details between dialog and panel.
 */
import { type Accessor, createEffect, createSignal, on, untrack } from "solid-js";
import type { AppActions, AppState } from "../context/state";
import type { DiffTarget } from "../git/types";
import type { DialogId } from "../hooks/use-keyboard-navigation";
import type { OpenShiftResource } from "../providers/openshift/types";
import type { JobLogTarget } from "../providers/shared/job-log-dialog";
import { DETAIL_CHILD_DIALOGS } from "../utils/keyboard-nav-utils";

export type LayoutMode = "too-small" | "compact" | "normal";

export function useDialogHost(opts: { state: AppState; actions: AppActions; layoutMode: Accessor<LayoutMode> }) {
  const { state, actions, layoutMode } = opts;
  const [dialog, setDialog] = createSignal<DialogId>(null);
  /** The diff dialog's file (set when a file is opened from the details). */
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget | null>(null);
  /** The log dialog's job, build or failed test, as its provider built it. */
  const [jobLogTarget, setJobLogTarget] = createSignal<JobLogTarget | null>(null);
  const [openShiftResourceTarget, setOpenShiftResourceTarget] = createSignal<OpenShiftResource | null>(null);
  const dashboardShown = () => state.activeProviderView() === "dashboard";

  // Seamless resize transitions between layout modes:
  // - Normal → Compact while detail is focused: auto-open the detail dialog, unless another dialog is open (a diff
  //   or log opened from the details stays; closing it goes back to the details)
  // - Compact → Normal while detail dialog is open: close dialog, keep detail focused
  // Uses untrack() for dialog() so this effect only fires on layoutMode changes,
  // not every time any dialog (e.g. diff-blame) opens/closes.
  createEffect(() => {
    const mode = layoutMode();
    const currentDialog = untrack(dialog);
    if (mode === "compact" && state.detailFocused() && currentDialog === null) {
      // The dashboard's details have their own dialog.
      setDialog(untrack(dashboardShown) ? "dashboard-event" : "detail");
    } else if (mode === "normal" && currentDialog === "detail") {
      setDialog(null);
      // detailFocused stays true — panel is now visible in two-column layout
    } else if (mode === "normal" && currentDialog === "dashboard-event") {
      // The side panel shows the event now.
      setDialog(null);
    }
  });

  // The compact details belong to the graph: the Dashboard closes them (it has its own), and back in the graph, with
  // its details still focused, they open again as they were left.
  createEffect(
    on(
      dashboardShown,
      shown => {
        if (untrack(layoutMode) !== "compact") return;
        const current = untrack(dialog);
        if (shown && current === "detail") setDialog(null);
        else if (!shown && current === null && untrack(() => state.detailFor("graph").detailFocused()))
          setDialog("detail");
      },
      { defer: true },
    ),
  );

  return {
    dialog,
    setDialog,
    diffTarget,
    setDiffTarget,
    jobLogTarget,
    openShiftResourceTarget,
    /** The diff dialog for a file. */
    openDiff: (target: DiffTarget) => {
      setDiffTarget(target);
      setDialog("diff-blame");
    },
    /** The log viewer with what a provider built for it (a job, a build at an entry, a failed test). */
    openJobLog: (target: JobLogTarget | null) => {
      if (!target) return;
      setJobLogTarget(target);
      setDialog("job-log");
    },
    openResource: (resource: OpenShiftResource) => {
      setOpenShiftResourceTarget(resource);
      setDialog("openshift-resource");
    },
    /** A dialog the Menu opens (the theme picker). */
    openFromMenu: (id: "theme") => {
      if (id === "theme") setDialog("theme");
    },
    /** While a log dialog's search owns Esc, the app's Esc (cascade close) must not close the dialog. */
    setLogSearchScope: (active: boolean) => actions.setKeyboardScopeOverride(active ? "log-search" : null),
    /** A dialog opened from the compact details is showing; they wait under it. */
    compactDetailUnderChild: () =>
      DETAIL_CHILD_DIALOGS.has(dialog() ?? "") &&
      layoutMode() === "compact" &&
      state.detailFocused() &&
      !dashboardShown(),
    /** Dialogs opened from the details return to the compact detail dialog when they close. */
    closeToDetail: () => {
      if (layoutMode() === "compact" && state.detailFocused())
        setDialog(dashboardShown() ? "dashboard-event" : "detail");
      else setDialog(null);
    },
  };
}

export type DialogHost = ReturnType<typeof useDialogHost>;
