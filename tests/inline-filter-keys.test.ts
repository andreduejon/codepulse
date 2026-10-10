import { expect, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { handleCommandOrPathKey, handleSearchKey } from "../src/hooks/handle-command-bar-keys";
import type { CommandBarMode } from "../src/hooks/use-keyboard-navigation";

test("inline search/path cancel preserves filter; Enter applies trimmed or empty draft", () => {
  for (const kind of ["search", "path"] as const) {
    let mode: CommandBarMode = kind;
    let applied = "existing";
    let draft = " draft ";
    const exitCommandBar = () => {
      mode = "idle";
    };
    const dispatch = (name: string) => {
      const event = { name, preventDefault() {} } as KeyEvent;
      if (kind === "search")
        return handleSearchKey(
          event,
          {
            commandBarMode: () => mode,
            searchInputValue: () => draft,
            onSearchExecute: value => {
              applied = value;
            },
          },
          { exitCommandBar },
        );
      return handleCommandOrPathKey(
        event,
        {
          commandBarMode: () => mode,
          commandBarValue: () => draft,
          onPathExecute: value => {
            applied = value;
          },
          onCommandExecute: () => {},
        },
        { exitCommandBar },
      );
    };
    expect(dispatch("x")).toBe(true);
    expect(applied).toBe("existing");
    dispatch("escape");
    expect(String(mode)).toBe("idle");
    expect(applied).toBe("existing");
    mode = kind;
    dispatch("return");
    expect(applied).toBe("draft");
    expect(String(mode)).toBe("idle");
    mode = kind;
    draft = " ";
    dispatch("return");
    expect(applied).toBe("");
  }
});
