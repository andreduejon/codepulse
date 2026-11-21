import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { BANNER } from "../../core/banner";
import type { GitPort } from "../../core/git/port";
import type { Commit } from "../../core/git/types";
import { GitContext } from "../context/git";
import { AppStateContext, createAppState } from "../context/state";
import { type StashState, useStashState } from "./use-stash-state";

test("a stash whose files can't be read says so and closes again, so opening it again reads it again", async () => {
  const app = createAppState();
  let reads = 0;
  const git = {
    getStashFiles: async () => {
      reads++;
      throw new Error("fatal: unable to read tree 0123456");
    },
  } as unknown as GitPort;
  const commit = { hash: "a".repeat(40) } as Commit;
  let stash!: StashState;
  const Probe = () => {
    stash = useStashState(() => commit);
    return <text>probe</text>;
  };
  const setup = await testRender(() => (
    <GitContext.Provider value={git}>
      <AppStateContext.Provider value={app}>
        <Probe />
      </AppStateContext.Provider>
    </GitContext.Provider>
  ));
  try {
    await stash.toggleStash("s1");
    expect(app.state.error()).toBe(BANNER.git.detailFailed);
    expect(stash.expandedStashes().has("s1")).toBe(false);
    await stash.toggleStash("s1");
    expect(reads).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});
