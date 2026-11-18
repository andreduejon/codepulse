import { expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { OpenShiftEventsTab } from "./events-tab";

const SHA = "a".repeat(40);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const warning = (overrides: Partial<OpenShiftWarning>): OpenShiftWarning => ({
  id: "event-1",
  namespace: "shop-test",
  kind: "Pod",
  name: "shop-api-7d9f8-x2k4q",
  reason: "BackOff",
  message: "Back-off restarting failed container api in pod shop-api-7d9f8-x2k4q",
  count: 61,
  firstSeen: minutesAgo(40),
  lastSeen: minutesAgo(2),
  ...overrides,
});

async function renderEventsTab(warnings: OpenShiftWarning[]) {
  const data: OpenShiftCommitData = { sha: SHA, liveFetched: true, namespaces: [], warnings };
  const [cursor, setCursor] = createSignal(0);
  const action = mock((_action: string | null) => {});
  const opened = mock((_resource: OpenShiftResource) => {});
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={60} flexDirection="column">
          <OpenShiftEventsTab
            sha={SHA}
            getCommitData={() => data}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={action}
            setDetailCursorIndex={setCursor}
            onOpenResource={opened}
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 64, height: 24 },
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  await settle();
  const frame = () => setup.captureCharFrame();
  const enter = () => navRef.activateCurrentItem();
  return { ...setup, navRef, setCursor, settle, frame, enter, action, opened };
}

test("the commit's warnings by namespace, newest first: reason, resource and when", async () => {
  const t = await renderEventsTab([
    warning({ id: "event-1" }),
    warning({ id: "event-2", reason: "Unhealthy", message: "Readiness probe failed", lastSeen: minutesAgo(1) }),
    warning({ id: "event-3", namespace: "shop-dev", kind: "Build", name: "shop-api-41", reason: "BuildFailed" }),
  ]);
  try {
    const lines = t
      .frame()
      .split("\n")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    // Namespaces by name, so a new warning never moves them; the cursor is on the first namespace.
    expect(lines.slice(0, 6)).toEqual([
      "total warnings 3",
      "├─ ▾ shop-dev 1",
      "│ └─ BuildFailed Build shop-api-41 2m ago",
      "└─ ▾ shop-test 2",
      "├─ Unhealthy Pod shop-api-7d9f8-x2k4q 1m ago",
      "└─ BackOff Pod shop-api-7d9f8-x2k4q 2m ago",
    ]);
  } finally {
    t.renderer.destroy();
  }
});

test("a selected warning adds no lines: its message is in the resource dialog", async () => {
  const t = await renderEventsTab([
    warning({ id: "event-1", lastSeen: minutesAgo(5) }),
    warning({ id: "event-2", reason: "Unhealthy", message: "Readiness probe failed", lastSeen: minutesAgo(1) }),
  ]);
  try {
    const before = t.frame();
    for (const index of [1, 2]) {
      t.setCursor(index);
      await t.settle();
      expect(t.frame()).not.toMatch(/Readiness probe failed|Back-off restarting|times/);
      // The rows stay where they were.
      expect(
        t
          .frame()
          .split("\n")
          .map(line => line.trim()),
      ).toEqual(before.split("\n").map(line => line.trim()));
    }
  } finally {
    t.renderer.destroy();
  }
});

test("Enter on a warning opens its resource's events; on a namespace it closes the namespace", async () => {
  const t = await renderEventsTab([warning({})]);
  try {
    t.setCursor(1);
    await t.settle();
    expect(t.action).toHaveBeenLastCalledWith("events");
    t.enter();
    expect(t.opened).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "shop-test", name: "shop-api-7d9f8-x2k4q" }),
    );
    t.setCursor(0);
    await t.settle();
    t.enter();
    await t.settle();
    expect(t.frame()).toContain("▸ shop-test");
    expect(t.frame()).not.toContain("BackOff");
  } finally {
    t.renderer.destroy();
  }
});

test("a warning about a resource without events of its own (a ReplicaSet) has no Enter", async () => {
  const t = await renderEventsTab([warning({ kind: "ReplicaSet", name: "shop-api-7d9f8", reason: "FailedCreate" })]);
  try {
    t.setCursor(1);
    await t.settle();
    expect(t.action).toHaveBeenLastCalledWith(null);
    t.enter();
    expect(t.opened).not.toHaveBeenCalled();
  } finally {
    t.renderer.destroy();
  }
});

test("no warnings says so", async () => {
  const t = await renderEventsTab([]);
  try {
    expect(t.frame()).toContain("No warnings about this commit's resources.");
  } finally {
    t.renderer.destroy();
  }
});
