import type { DialogId } from "../hooks/use-keyboard-navigation";
import { dialogToKeyboardScope, isAppScope, type KeyboardScope } from "./scope";

export interface KeyboardRouteInput {
  dialog: DialogId;
  overrideScope?: KeyboardScope | null;
}

export interface KeyboardRouteDecision {
  scope: KeyboardScope;
  runAppHandler: boolean;
  runCascadeClose: boolean;
}

export function routeGlobalKey(input: KeyboardRouteInput, keyName: string): KeyboardRouteDecision {
  const scope = input.overrideScope ?? dialogToKeyboardScope(input.dialog);
  const runAppHandler = isAppScope(scope);

  return {
    scope,
    runAppHandler,
    runCascadeClose: !runAppHandler && keyName === "escape",
  };
}
