import { expect, spyOn, test } from "bun:test";
import { testRender, useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createThemeState, ThemeContext } from "../../context/theme";
import JobLogDialog from "./job-log-dialog";

type Target = {
  provider: "github-actions";
  job: { id: number; name: string };
  jobs: { id: number; name: string }[];
  run: { name: string; runNumber: number };
  fetchLog: () => Promise<string>;
  noun: string;
};

/** The app's own key handler, registered before any dialog: Esc closes the open one. */
function AppKeys(props: { onEscape: () => void }) {
  useKeyboard(event => {
    if (event.name === "escape") props.onEscape();
  });
  return null;
}

test("esc that the app handles first closes the log without its handler reading the target that went", async () => {
  const jobs = [
    { id: 1, name: "build" },
    { id: 2, name: "test" },
  ];
  const [target, setTarget] = createSignal<Target | null>({
    provider: "github-actions",
    job: jobs[1],
    jobs,
    run: { name: "CI", runNumber: 812 },
    fetchLog: async () => "##[error]Run tests failed",
    noun: "job",
  });
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <AppKeys onEscape={() => setTarget(null)} />
        <Show when={target()}>
          {opened => (
            <JobLogDialog
              provider={opened().provider}
              job={opened().job}
              jobs={opened().jobs}
              run={opened().run}
              fetchLog={opened().fetchLog}
              entryNoun={opened().noun}
              onClose={() => setTarget(null)}
            />
          )}
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 80, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Run tests failed");
    setup.mockInput.pressEscape();
    await setup.flush();
    expect(target()).toBeNull();
    expect(errors.mock.calls.map(call => String(call[0]))).toEqual([]);
  } finally {
    errors.mockRestore();
    setup.renderer.destroy();
  }
});
