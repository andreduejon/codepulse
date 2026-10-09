import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAppState } from "../src/context/state";
import { buildGraph } from "../src/git/graph";
import { useAncestry } from "../src/hooks/use-ancestry";

test("mouse selection reanchors only outside active chain; cursor moves preserve anchor", () => {
  createRoot(dispose => {
    try {
      const { state, actions } = createAppState(100, 0, 0);
      const commits = [
        { hash: "main", parents: ["base"] },
        { hash: "side", parents: ["base"] },
        { hash: "base", parents: [] },
      ].map(commit => ({
        ...commit,
        shortHash: commit.hash,
        subject: commit.hash,
        body: "",
        author: "Author",
        authorEmail: "author@example.com",
        authorDate: "2026-01-01T00:00:00Z",
        committer: "Author",
        committerEmail: "author@example.com",
        commitDate: "2026-01-01T00:00:00Z",
        refs: [],
      }));
      actions.setGraphRows(buildGraph(commits));
      const ancestry = useAncestry(state, actions);
      ancestry.reanchorIfOutsideChain("side");
      expect(state.ancestrySet()).toBeNull();
      ancestry.setAnchor("main");
      const mainChain = state.ancestrySet();
      expect(mainChain).toEqual(new Set(["main", "base"]));
      ancestry.reanchorIfOutsideChain("base");
      expect(state.ancestrySet()).toBe(mainChain);
      actions.moveCursor(1);
      expect(state.ancestrySet()).toBe(mainChain);
      ancestry.reanchorIfOutsideChain("side");
      expect(state.ancestrySet()).toEqual(new Set(["side", "base"]));
      const sideChain = state.ancestrySet();
      actions.moveCursor(1);
      expect(state.ancestrySet()).toBe(sideChain);
    } finally {
      dispose();
    }
  });
});
