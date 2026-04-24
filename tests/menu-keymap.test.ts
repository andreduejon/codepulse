import { describe, expect, it } from "bun:test";
import { routeMenuKey } from "../src/components/dialogs/menu-keymap";

describe("menu keymap", () => {
  it("closes from normal mode on escape", () => {
    expect(routeMenuKey({ mode: "normal", keyName: "escape", selectedKind: "other" })).toEqual({
      action: "close",
      consume: true,
    });
  });

  it("moves and switches tabs in normal mode", () => {
    expect(routeMenuKey({ mode: "normal", keyName: "down", selectedKind: "other" }).action).toBe("move-down");
    expect(routeMenuKey({ mode: "normal", keyName: "up", selectedKind: "other" }).action).toBe("move-up");
    expect(routeMenuKey({ mode: "normal", keyName: "left", selectedKind: "other" }).action).toBe("prev-tab");
    expect(routeMenuKey({ mode: "normal", keyName: "right", selectedKind: "other" }).action).toBe("next-tab");
  });

  it("starts edit only when selected row is editable", () => {
    expect(routeMenuKey({ mode: "normal", keyName: "return", selectedKind: "editable" })).toEqual({
      action: "start-edit",
      consume: true,
    });
    expect(routeMenuKey({ mode: "normal", keyName: "return", selectedKind: "other" })).toEqual({
      action: "activate",
      consume: true,
    });
  });

  it("does not consume printable keys in normal mode", () => {
    expect(routeMenuKey({ mode: "normal", keyName: "a", selectedKind: "editable" })).toEqual({
      action: "none",
      consume: false,
    });
  });

  it("maps edit mode control keys and leaves text keys for native input", () => {
    expect(routeMenuKey({ mode: "token-edit", keyName: "return", selectedKind: "editable" })).toEqual({
      action: "save-edit",
      consume: true,
    });
    expect(routeMenuKey({ mode: "token-edit", keyName: "escape", selectedKind: "editable" })).toEqual({
      action: "cancel-edit",
      consume: true,
    });
    expect(routeMenuKey({ mode: "token-edit", keyName: "down", selectedKind: "editable" })).toEqual({
      action: "none",
      consume: true,
    });
    expect(routeMenuKey({ mode: "token-edit", keyName: "up", selectedKind: "editable" })).toEqual({
      action: "none",
      consume: true,
    });
    expect(routeMenuKey({ mode: "token-edit", keyName: "x", selectedKind: "editable" })).toEqual({
      action: "none",
      consume: false,
    });
  });
});
