import { expect, test } from "bun:test";
import type { Commit } from "./git/types";
import { toggleAncestry } from "./highlights";

function harness(ancestry: Set<string> | null) {
  const app = { search: "fix", path: "src" as string | null, anchor: null as string | null, cleared: false };
  const ports = {
    state: { ancestrySet: () => ancestry, selectedCommit: () => ({ hash: "abc" }) as Commit },
    actions: {
      setSearchQuery: (query: string) => {
        app.search = query;
      },
      setPathFilter: (path: string | null) => {
        app.path = path;
      },
      setPathMatchSet: () => {},
    },
    setAnchor: (hash: string) => {
      app.anchor = hash;
    },
    clearAnchor: () => {
      app.cleared = true;
    },
  };
  return { app, ports };
}

test("ancestry turns on at the selected commit and ends search and path mode", () => {
  const h = harness(null);
  toggleAncestry(h.ports);
  expect(h.app).toEqual({ search: "", path: null, anchor: "abc", cleared: false });
});

test("ancestry that is on turns off and leaves the other modes alone", () => {
  const h = harness(new Set(["abc"]));
  toggleAncestry(h.ports);
  expect(h.app).toEqual({ search: "fix", path: "src", anchor: null, cleared: true });
});
