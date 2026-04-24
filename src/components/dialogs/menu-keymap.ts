export type MenuKeyMode = "normal" | "token-edit";
export type MenuSelectableKind = "editable" | "other" | null;

export type MenuKeyAction =
  | "none"
  | "close"
  | "move-down"
  | "move-up"
  | "activate"
  | "start-edit"
  | "save-edit"
  | "cancel-edit"
  | "prev-tab"
  | "next-tab";

export interface MenuKeyInput {
  mode: MenuKeyMode;
  keyName: string;
  shift?: boolean;
  selectedKind: MenuSelectableKind;
}

export interface MenuKeyDecision {
  action: MenuKeyAction;
  consume: boolean;
}

export function routeMenuKey(input: MenuKeyInput): MenuKeyDecision {
  const { mode, keyName, selectedKind } = input;

  if (mode === "token-edit") {
    switch (keyName) {
      case "escape":
        return { action: "cancel-edit", consume: true };
      case "return":
        return { action: "save-edit", consume: true };
      case "up":
      case "down":
        return { action: "none", consume: true };
      default:
        return { action: "none", consume: false };
    }
  }

  switch (keyName) {
    case "escape":
      return { action: "close", consume: true };
    case "down":
      return { action: "move-down", consume: true };
    case "up":
      return { action: "move-up", consume: true };
    case "left":
      return { action: "prev-tab", consume: true };
    case "right":
      return { action: "next-tab", consume: true };
    case "return":
      return { action: selectedKind === "editable" ? "start-edit" : "activate", consume: true };
    default:
      return { action: "none", consume: false };
  }
}
