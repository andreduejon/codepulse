import type { DialogId } from "../hooks/use-keyboard-navigation";

export type KeyboardScope =
  | "app"
  | "menu"
  | "menu-token-edit"
  | "help"
  | "theme"
  | "diff-blame"
  | "detail-dialog"
  | "job-log";

export function dialogToKeyboardScope(dialog: DialogId): KeyboardScope {
  switch (dialog) {
    case "menu":
      return "menu";
    case "help":
      return "help";
    case "theme":
      return "theme";
    case "diff-blame":
      return "diff-blame";
    case "detail":
      return "detail-dialog";
    case "job-log":
      return "job-log";
    default:
      return "app";
  }
}

export function isAppScope(scope: KeyboardScope): boolean {
  return scope === "app" || scope === "detail-dialog";
}
