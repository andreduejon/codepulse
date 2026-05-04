import { describe, expect, it } from "bun:test";
import { routeGlobalKey } from "../src/keyboard/router";
import { dialogToKeyboardScope } from "../src/keyboard/scope";

describe("keyboard scope routing", () => {
  it("uses app scope when no dialog is open", () => {
    expect(dialogToKeyboardScope(null)).toBe("app");
    expect(routeGlobalKey({ dialog: null }, "tab")).toEqual({
      scope: "app",
      runAppHandler: true,
      runCascadeClose: false,
    });
  });

  it("allows app handler for compact detail dialog", () => {
    expect(routeGlobalKey({ dialog: "detail" }, "return")).toEqual({
      scope: "detail-dialog",
      runAppHandler: true,
      runCascadeClose: false,
    });
  });

  it("blocks app shortcuts while menu is open", () => {
    expect(routeGlobalKey({ dialog: "menu" }, "tab")).toEqual({
      scope: "menu",
      runAppHandler: false,
      runCascadeClose: false,
    });
    expect(routeGlobalKey({ dialog: "menu" }, ":")).toEqual({
      scope: "menu",
      runAppHandler: false,
      runCascadeClose: false,
    });
  });

  it("lets escape cascade-close modal dialogs", () => {
    expect(routeGlobalKey({ dialog: "menu" }, "escape")).toEqual({
      scope: "menu",
      runAppHandler: false,
      runCascadeClose: true,
    });
    expect(routeGlobalKey({ dialog: "job-log" }, "escape")).toEqual({
      scope: "job-log",
      runAppHandler: false,
      runCascadeClose: true,
    });
  });

  it("supports explicit modal sub-mode overrides", () => {
    expect(routeGlobalKey({ dialog: "menu", overrideScope: "menu-token-edit" }, "tab")).toEqual({
      scope: "menu-token-edit",
      runAppHandler: false,
      runCascadeClose: false,
    });
    expect(routeGlobalKey({ dialog: "menu", overrideScope: "menu-token-edit" }, "escape")).toEqual({
      scope: "menu-token-edit",
      runAppHandler: false,
      runCascadeClose: true,
    });
  });
});
