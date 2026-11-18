/** The terminal's own state names: its dialogs and the command bar's modes. */

export type DialogId =
  | "menu"
  | "help"
  | "theme"
  | "diff-blame"
  | "detail"
  /** The selected dashboard event's details, in the compact layout. */
  | "dashboard-event"
  | "job-log"
  /** A provider's own dialog (OpenShift's resource). */
  | "provider"
  | "debug"
  | null;

/** Command bar mode — drives placeholder text and key routing. */
export type CommandBarMode = "idle" | "command" | "search" | "path";
