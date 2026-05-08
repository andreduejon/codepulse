import { describe, expect, test } from "bun:test";
import { buildProjectSelectorRows } from "../src/utils/project-selector-rows";

describe("buildProjectSelectorRows", () => {
  test("groups and sorts repos by group and appName", () => {
    const backend = { path: "/repos/backend", group: "e-ant", appName: "e/ant Backend" };
    const gateway = { path: "/repos/gateway", group: "platform", appName: "API Gateway" };
    const frontend = { path: "/repos/frontend", group: "e-ant", appName: "e/ant Frontend" };

    expect(buildProjectSelectorRows([backend, gateway, frontend], "/repos/frontend")).toEqual([
      { kind: "group", label: "e-ant" },
      { kind: "repo", label: "e/ant Backend", repo: backend, current: false },
      { kind: "repo", label: "e/ant Frontend", repo: frontend, current: true },
      { kind: "spacer", label: "" },
      { kind: "group", label: "platform" },
      { kind: "repo", label: "API Gateway", repo: gateway, current: false },
      { kind: "spacer", label: "" },
      { kind: "path-input", label: "" },
    ]);
  });

  test("places ungrouped repos under ungrouped heading", () => {
    const plain = { path: "/repos/plain" };
    expect(buildProjectSelectorRows([plain])).toEqual([
      { kind: "group", label: "ungrouped" },
      { kind: "repo", label: "plain", repo: plain, current: false },
      { kind: "spacer", label: "" },
      { kind: "path-input", label: "" },
    ]);
  });

  test("adds path detail for duplicate labels", () => {
    const first = { path: "/repos/a/service" };
    const second = { path: "/repos/b/service" };

    expect(buildProjectSelectorRows([first, second])).toEqual([
      { kind: "group", label: "ungrouped" },
      { kind: "repo", label: "service", detail: "a/service", repo: first, current: false },
      { kind: "repo", label: "service", detail: "b/service", repo: second, current: false },
      { kind: "spacer", label: "" },
      { kind: "path-input", label: "" },
    ]);
  });
});
