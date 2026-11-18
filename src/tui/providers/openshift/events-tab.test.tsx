import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
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

async function renderEventsTab(
  warnings: OpenShiftWarning[],
  options: { cached?: readonly string[]; removed?: readonly string[] } = {},
) {
  const data: OpenShiftCommitData = { sha: SHA, liveFetched: true, namespaces: [], warnings };
  const [cursor, setCursor] = createSignal(0);
  const action = mock((_action: string | null) => {});
  const opened = mock((_resource: OpenShiftResource, _options?: { eventsOnly: boolean }) => {});
  const fetchCommitData = mock(async (_sha: string, _force?: boolean) => {});
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
            fetchCommitData={fetchCommitData}
            liveAge={() => "live"}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={action}
            setDetailCursorIndex={setCursor}
            onOpenResource={opened}
            isCached={entry => options.cached?.includes(entry.id) ?? false}
            isPresent={entry => !options.removed?.includes(entry.id)}
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
  const lines = () =>
    frame()
      .split("\n")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  /** Puts the cursor on the row with this text and presses Enter. The count line (the second) is no stop. */
  const enterOn = async (text: string) => {
    const line = lines().findIndex(entry => entry.includes(text));
    setCursor(line === 0 ? 0 : line - 1);
    await settle();
    navRef.activateCurrentItem();
    await settle();
  };
  const fgOf = (text: string) => {
    const y = frame()
      .split("\n")
      .findIndex(line => line.includes(text));
    return setup.captureSpans().lines[y]?.spans.find(span => span.text.includes(text))?.fg;
  };
  return {
    ...setup,
    setCursor,
    settle,
    frame,
    lines,
    enterOn,
    fgOf,
    action,
    opened,
    fetchCommitData,
    theme: theme.theme(),
  };
}

test("Reload commit, the count, then namespace, resource and its warnings, newest first", async () => {
  const t = await renderEventsTab([
    warning({ id: "event-1" }),
    warning({ id: "event-2", reason: "Unhealthy", message: "Readiness probe failed", lastSeen: minutesAgo(1) }),
    warning({ id: "event-3", namespace: "shop-dev", kind: "Build", name: "shop-api-41", reason: "BuildFailed" }),
  ]);
  try {
    expect(t.lines()).toEqual([
      "Reload commit live",
      "total events 3",
      "├─ ▾ shop-dev 1",
      "│ └─ Build shop-api-41",
      "│ └─ BuildFailed 2m ago",
      "└─ ▾ shop-test 2",
      "└─ Pod shop-api-7d9f8-x2k4q",
      "├─ Unhealthy 1m ago",
      "└─ BackOff 2m ago",
    ]);
    await t.enterOn("Reload commit");
    expect(t.fetchCommitData).toHaveBeenLastCalledWith(SHA, true);
  } finally {
    t.renderer.destroy();
  }
});

test("a selected row adds no lines: the message is in the resource dialog", async () => {
  const t = await renderEventsTab([warning({ id: "event-1" })]);
  try {
    const before = t.lines();
    for (const index of [2, 3]) {
      t.setCursor(index);
      await t.settle();
      expect(t.lines()).toEqual(before);
    }
    expect(t.frame()).not.toMatch(/Back-off restarting|times/);
  } finally {
    t.renderer.destroy();
  }
});

test("Enter on a resource or a warning opens the resource's events; on a namespace it closes it", async () => {
  const t = await renderEventsTab([warning({})]);
  try {
    await t.enterOn("Pod shop-api-7d9f8-x2k4q");
    expect(t.action).toHaveBeenLastCalledWith("events");
    expect(t.opened).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "shop-test", name: "shop-api-7d9f8-x2k4q" }),
      { eventsOnly: false },
    );
    await t.enterOn("BackOff");
    expect(t.opened).toHaveBeenCalledTimes(2);
    await t.enterOn("shop-test");
    expect(t.frame()).toContain("▸ shop-test");
    expect(t.frame()).not.toContain("BackOff");
  } finally {
    t.renderer.destroy();
  }
});

test("a removed resource keeps its place, muted and marked; Enter shows only its events", async () => {
  const t = await renderEventsTab(
    [
      warning({ id: "event-1" }),
      warning({ id: "event-2", name: "shop-api-7d9f8-oom7k", reason: "OOMKilling", lastSeen: minutesAgo(18) }),
    ],
    { removed: ["event-2"] },
  );
  try {
    expect(t.lines().slice(2)).toEqual([
      "└─ ▾ shop-test 2",
      "├─ Pod shop-api-7d9f8-oom7k (removed)",
      "│ └─ OOMKilling 18m ago",
      "└─ Pod shop-api-7d9f8-x2k4q",
      "└─ BackOff 2m ago",
    ]);
    const muted = RGBA.fromHex(t.theme.foregroundMuted);
    expect(t.fgOf("OOMKilling")).toEqual(muted);
    expect(t.fgOf("BackOff")).toEqual(RGBA.fromHex(t.theme.foreground));
    await t.enterOn("OOMKilling");
    expect(t.opened).toHaveBeenLastCalledWith(expect.objectContaining({ name: "shop-api-7d9f8-oom7k" }), {
      eventsOnly: true,
    });
  } finally {
    t.renderer.destroy();
  }
});

test("a warning only the cache has says (cached)", async () => {
  const t = await renderEventsTab(
    [warning({ id: "event-1" }), warning({ id: "event-2", reason: "OOMKilling", lastSeen: minutesAgo(300) })],
    { cached: ["event-2"] },
  );
  try {
    expect(t.lines().find(line => line.includes("OOMKilling"))).toContain("OOMKilling (cached)");
    expect(t.lines().find(line => line.includes("BackOff"))).not.toContain("(cached)");
  } finally {
    t.renderer.destroy();
  }
});

test("a warning about a resource without events of its own (a ReplicaSet) has no Enter", async () => {
  const t = await renderEventsTab([warning({ kind: "ReplicaSet", name: "shop-api-7d9f8", reason: "FailedCreate" })]);
  try {
    await t.enterOn("FailedCreate");
    expect(t.action).toHaveBeenLastCalledWith(null);
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
