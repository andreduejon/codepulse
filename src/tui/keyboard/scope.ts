import type { DialogId } from "../app/ui-state";

/**
 * Whether the app's own keys drive what shows: no dialog, or the compact details (the graph's or the dashboard's),
 * which move like the panel beside the graph. Every other dialog handles its keys itself (`useModalKeys`).
 */
export function appKeysDrive(dialog: DialogId): boolean {
  return dialog == null || dialog === "detail" || dialog === "dashboard-event";
}
