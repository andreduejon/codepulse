import { describe, expect, test } from "bun:test";
import { buildProjectSelectorRows } from "../src/utils/project-selector-rows";

describe("buildProjectSelectorRows", () => {
  test("groups and sorts repos by group and appName", () => {
    expect(
      buildProjectSelectorRows([
        { path: "/repos/backend", group: "e-ant", appName: "e/ant Backend" },
        { path: "/repos/gateway", group: "platform", appName: "API Gateway" },
        { path: "/repos/frontend", group: "e-ant", appName: "e/ant Frontend" },
      ]),
    ).toEqual([
      { kind: "group", label: "e-ant" },
      { kind: "repo", label: "e/ant Backend", repoIndex: 0 },
      { kind: "repo", label: "e/ant Frontend", repoIndex: 2 },
      { kind: "spacer", label: "" },
      { kind: "group", label: "platform" },
      { kind: "repo", label: "API Gateway", repoIndex: 1 },
    ]);
  });

  test("places ungrouped repos under ungrouped heading", () => {
    expect(buildProjectSelectorRows([{ path: "/repos/plain" }])).toEqual([
      { kind: "group", label: "ungrouped" },
      { kind: "repo", label: "/repos/plain", repoIndex: 0 },
    ]);
  });
});
