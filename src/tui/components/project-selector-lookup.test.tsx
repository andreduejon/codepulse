import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { GitPort } from "../../core/git/port";
import { GitContext } from "../context/git";
import { createThemeState, ThemeContext } from "../context/theme";
import ProjectSelector from "./project-selector";

/** A Git port whose root lookups wait until the test answers them. */
function slowGit() {
  const lookups: Array<{ path: string; signal?: AbortSignal; answer: (root: string) => void }> = [];
  const git = {
    getRepoRoot: (path: string, signal?: AbortSignal) =>
      new Promise<string | null>(resolve => lookups.push({ path, signal, answer: resolve })),
  } as unknown as GitPort;
  return { git, lookups };
}

async function selector() {
  const { git, lookups } = slowGit();
  const selected: string[] = [];
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <GitContext.Provider value={git}>
          <Show when={open()}>
            <ProjectSelector
              knownRepos={[
                { path: "/repo/alpha", appName: "Alpha", group: "Group A" },
                { path: "/repo/beta", appName: "Beta", group: "Group A" },
              ]}
              currentRepo="/repo/current"
              onSelectRepo={path => selected.push(path)}
              onCancel={() => setOpen(false)}
            />
          </Show>
        </GitContext.Provider>
      </ThemeContext.Provider>
    ),
    { width: 110, height: 40, kittyKeyboard: true },
  );
  const key = async (name: Parameters<typeof setup.mockInput.pressKey>[0]) => {
    setup.mockInput.pressKey(name);
    await setup.flush();
  };
  await setup.flush();
  return { setup, lookups, selected, key };
}

test("a project picked while another is still being looked up opens alone, whichever lookup ends first", async () => {
  const s = await selector();
  try {
    await s.key("RETURN");
    await s.key("ARROW_DOWN");
    await s.key("RETURN");
    expect(s.lookups.map(lookup => lookup.path)).toEqual(["/repo/alpha", "/repo/beta"]);
    expect(s.lookups[0]?.signal?.aborted).toBe(true);
    s.lookups[1]?.answer("/repo/beta");
    s.lookups[0]?.answer("/repo/alpha");
    await s.setup.flush();
    expect(s.selected).toEqual(["/repo/beta"]);
  } finally {
    s.setup.renderer.destroy();
  }
});

test("a project picked and then left with Esc does not open when its lookup ends", async () => {
  const s = await selector();
  try {
    await s.key("RETURN");
    await s.key("ESCAPE");
    expect(s.lookups[0]?.signal?.aborted).toBe(true);
    s.lookups[0]?.answer("/repo/alpha");
    await s.setup.flush();
    expect(s.selected).toEqual([]);
  } finally {
    s.setup.renderer.destroy();
  }
});
