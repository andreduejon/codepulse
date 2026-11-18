import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAppState } from "../context/state";
import type { JobLogTarget } from "../providers/shared/job-log-dialog";
import { useDialogHost } from "./dialogs";

test("a closed log or provider dialog lets go of what it showed: a finished build's console is not kept", () => {
  const { host, dispose } = createRoot(dispose => {
    const { state } = createAppState();
    return { host: useDialogHost({ state, layoutMode: () => "normal" }), dispose };
  });
  try {
    const target = { provider: "jenkins", job: { id: 1, name: "Build" }, jobs: [] } as unknown as JobLogTarget;
    host.openJobLog(target);
    expect(host.jobLogTarget()).toBe(target);
    host.closeToDetail();
    expect(host.dialog()).toBeNull();
    expect(host.jobLogTarget()).toBeNull();

    host.openProviderDialog(() => null);
    expect(host.providerDialog()).not.toBeNull();
    host.setDialog(null);
    expect(host.providerDialog()).toBeNull();
  } finally {
    dispose();
  }
});
