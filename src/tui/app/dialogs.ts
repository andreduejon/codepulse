/**
 * The dialog host: which dialog is open and what it shows (a file's diff, a job's log, a provider's own), opening
 * them, and where closing one goes back to. In the compact layout the details are a dialog too: a dialog opened from
 * them returns to them, and resizing across the side panel's width moves the details between dialog and panel.
 */
import { type Accessor, createEffect, createSignal, type JSX, on, untrack } from "solid-js";
import type { DiffTarget } from "../../core/git/types";
import type { AppState } from "../context/state";
import { DETAIL_CHILD_DIALOGS } from "../keyboard/cascade";
import type { JobLogTarget } from "../providers/shared/job-log-dialog";
import type { DialogId } from "./ui-state";

export type LayoutMode = "too-small" | "compact" | "normal";

export function useDialogHost(opts: { state: AppState; layoutMode: Accessor<LayoutMode> }) {
  const { state, layoutMode } = opts;
  const [dialog, setDialog] = createSignal<DialogId>(null);
  /** The diff dialog's file (set when a file is opened from the details). */
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget | null>(null);
  /** The log dialog's job, build or failed test, as its provider built it. */
  const [jobLogTarget, setJobLogTarget] = createSignal<JobLogTarget | null>(null);
  /** A provider's own dialog (OpenShift's resource), drawn with the function that closes it. */
  const [providerDialog, setProviderDialog] = createSignal<((close: () => void) => JSX.Element) | null>(null);
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

  // A closed log or provider dialog lets go of what it showed: a finished build's console can be large, and a
  // provider's dialog holds its provider's reads.
  createEffect(
    on(dialog, current => {
      if (current !== "job-log") setJobLogTarget(null);
      if (current !== "provider") setProviderDialog(null);
    }),
  );

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
    providerDialog,
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
    /** A provider's own dialog over the app (OpenShift's resource). */
    openProviderDialog: (render: (close: () => void) => JSX.Element) => {
      setProviderDialog(() => render);
      setDialog("provider");
    },
    /** A dialog the Menu opens (the theme picker). */
    openFromMenu: (id: "theme") => {
      if (id === "theme") setDialog("theme");
    },
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
