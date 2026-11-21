import { expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { OpenShiftFailure } from "../../../core/openshift/failures";
import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import { type OpenShiftWarning, warningTarget } from "../../../core/openshift/warnings";
import { createDetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { OpenShiftEventsTab } from "./events-tab";
import { namespaceKey, reasonKey } from "./events-tree";

const SHA = "a".repeat(40);
// One now for the file: two warnings made a millisecond apart would otherwise sort by that millisecond.
const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

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
  options: {
    cached?: readonly string[];
    removed?: readonly string[];
    pruned?: readonly string[];
    normal?: OpenShiftWarning[];
    failures?: OpenShiftFailure[];
    target?: string;
    /** Namespaces and reasons closed before the tab opens (its memory). */
    collapsed?: readonly string[];
  } = {},
) {
  // The commit holds what the warnings are about, but a removed one; a pruned build only from the cache.
  const held = (kind: string) =>
    warnings
      .filter(entry => entry.kind === kind && !options.removed?.includes(entry.id))
      .map(
        (entry): OpenShiftResource => ({
          id: `${entry.kind}:${entry.namespace}:${entry.name}`,
          kind: entry.kind as OpenShiftResource["kind"],
          namespace: entry.namespace,
          name: entry.name,
          status: "pass",
          imageRefs: [],
          ...(options.pruned?.includes(entry.id) ? { cacheOnly: true } : {}),
        }),
      );
  const namespaces = [...new Set(warnings.map(entry => entry.namespace))].map(namespace => {
    const inNamespace = (kind: string) => held(kind).filter(resource => resource.namespace === namespace);
    return {
      namespace,
      builds: inNamespace("Build"),
      imageStreamTags: [],
      deployments: inNamespace("Deployment"),
      deploymentConfigs: [],
      pods: inNamespace("Pod"),
    };
  });
  const data: OpenShiftCommitData = {
    sha: SHA,
    liveFetched: true,
    namespaces,
    warnings,
    ...(options.normal ? { normalEvents: options.normal } : {}),
    ...(options.failures ? { failures: options.failures } : {}),
  };
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
  const memory = createDetailMemory();
  if (options.collapsed) memory("events", () => ({ sha: SHA, collapsed: new Set(options.collapsed) }));
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
            isPresent={entry => !options.removed?.includes(entry.id) && !options.pruned?.includes(entry.id)}
            target={options.target}
            memory={memory}
            targetColor="#ff00ff"
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

test("Reload commit, the count, then namespace, reason newest first, and the resources it happened to", async () => {
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
      "│ └─ ▾ BuildFailed 1",
      "│ └─ shop-api-41 2m ago",
      "└─ ▾ shop-test 2",
      "├─ ▾ Unhealthy 1",
      "│ └─ shop-api-7d9f8-x2k4q 1m ago",
      "└─ ▾ BackOff 1",
      "└─ shop-api-7d9f8-x2k4q 2m ago",
    ]);
    // The reason leads, in the warning color.
    expect(t.fgOf("BuildFailed")).toEqual(RGBA.fromHex(t.theme.warning));
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

test("Enter on a resource opens its events; on a reason or a namespace it closes it", async () => {
  const t = await renderEventsTab([warning({})]);
  try {
    await t.enterOn("shop-api-7d9f8-x2k4q");
    expect(t.action).toHaveBeenLastCalledWith("events");
    expect(t.opened).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "shop-test", name: "shop-api-7d9f8-x2k4q" }),
      { eventsOnly: false },
    );
    await t.enterOn("BackOff");
    expect(t.frame()).toContain("▸ BackOff");
    expect(t.frame()).not.toContain("shop-api-7d9f8");
    await t.enterOn("shop-test");
    expect(t.frame()).toContain("▸ shop-test");
    expect(t.frame()).not.toContain("BackOff");
  } finally {
    t.renderer.destroy();
  }
});

test("a resource the cluster no longer has says (cached), muted; a replaced pod opens on its events only", async () => {
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
      "├─ ▾ BackOff 1",
      "│ └─ shop-api-7d9f8-x2k4q 2m ago",
      "└─ ▾ OOMKilling 1",
      "└─ shop-api-7d9f8-oom7k (cached) 18m ago",
    ]);
    expect(t.fgOf("shop-api-7d9f8-oom7k")).toEqual(RGBA.fromHex(t.theme.foregroundMuted));
    expect(t.fgOf("shop-api-7d9f8-x2k4q")).toEqual(RGBA.fromHex(t.theme.foreground));
    await t.enterOn("oom7k");
    expect(t.opened).toHaveBeenLastCalledWith(expect.objectContaining({ name: "shop-api-7d9f8-oom7k" }), {
      eventsOnly: true,
    });
  } finally {
    t.renderer.destroy();
  }
});

test("a resource whose events of a reason OpenShift deleted says (cached) under that reason only", async () => {
  const t = await renderEventsTab(
    [warning({ id: "event-1" }), warning({ id: "event-2", reason: "OOMKilling", lastSeen: minutesAgo(300) })],
    { cached: ["event-2"] },
  );
  try {
    // Under OOMKilling the pod's event is cached; under BackOff it is not.
    const rows = t.lines();
    expect(rows[rows.findIndex(line => line.includes("OOMKilling")) + 1]).toContain("x2k4q (cached)");
    expect(rows[rows.findIndex(line => line.includes("BackOff")) + 1]).not.toContain("(cached)");
  } finally {
    t.renderer.destroy();
  }
});

test("a warning about a ReplicaSet the cluster has opens it, on its events: no commit holds it", async () => {
  const t = await renderEventsTab([
    warning({ kind: "ReplicaSet", name: "shop-api-7d9f8", uid: "rs-uid", reason: "FailedCreate" }),
  ]);
  try {
    await t.enterOn("─ shop-api-7d9f8");
    expect(t.action).toHaveBeenLastCalledWith("events");
    expect(t.opened).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "ReplicaSet", name: "shop-api-7d9f8", uid: "rs-uid" }),
      { eventsOnly: false },
    );
  } finally {
    t.renderer.destroy();
  }
});

test("a commit without warnings shows only Reload commit and the count, as Resources does", async () => {
  const t = await renderEventsTab([]);
  try {
    expect(t.lines()).toEqual(["Reload commit live", "total events 0"]);
  } finally {
    t.renderer.destroy();
  }
});

test("a build OpenShift pruned says (cached), muted, and opens in full from the cache", async () => {
  const t = await renderEventsTab(
    [warning({ id: "event-1", namespace: "shop-dev", kind: "Build", name: "shop-api-39", reason: "BuildFailed" })],
    { pruned: ["event-1"] },
  );
  try {
    expect(t.lines()).toContain("└─ shop-api-39 (cached) 2m ago");
    expect(t.fgOf("shop-api-39")).toEqual(RGBA.fromHex(t.theme.foregroundMuted));
    await t.enterOn("shop-api-39");
    expect(t.opened).toHaveBeenLastCalledWith(expect.objectContaining({ name: "shop-api-39", cacheOnly: true }), {
      eventsOnly: false,
    });
  } finally {
    t.renderer.destroy();
  }
});

test("Normal events the cluster lists now follow the warnings, in the text color, and count in the total", async () => {
  const t = await renderEventsTab([warning({ id: "event-1" })], {
    normal: [
      warning({ id: "pulled", reason: "Pulled", message: "Container image already present", lastSeen: minutesAgo(1) }),
    ],
  });
  try {
    expect(t.lines()).toEqual([
      "Reload commit live",
      "total events 2",
      "└─ ▾ shop-test 2",
      "├─ ▾ BackOff 1",
      "│ └─ shop-api-7d9f8-x2k4q 2m ago",
      "└─ ▾ Pulled 1",
      "└─ shop-api-7d9f8-x2k4q 1m ago",
    ]);
    expect(t.fgOf("BackOff")).toEqual(RGBA.fromHex(t.theme.warning));
    expect(t.fgOf("Pulled")).toEqual(RGBA.fromHex(t.theme.foreground));
    // Never (cached) while listed, though no warning list holds its uid.
    expect(t.frame()).not.toContain("(cached)");
  } finally {
    t.renderer.destroy();
  }
});

test("what a failing resource's status says leads in red, with its part of the status; the total counts it", async () => {
  const crash: OpenShiftFailure = {
    ...warning({ id: "status:crash", reason: "CrashLoopBackOff", message: "back-off 5m0s", lastSeen: null }),
    status: "waiting",
  };
  const t = await renderEventsTab([warning({ id: "event-1" })], { failures: [crash] });
  try {
    expect(t.lines()).toEqual([
      "Reload commit live",
      "total events 2",
      "└─ ▾ shop-test 2",
      "├─ ▾ CrashLoopBackOff 1",
      "│ └─ shop-api-7d9f8-x2k4q waiting",
      "└─ ▾ BackOff 1",
      "└─ shop-api-7d9f8-x2k4q 2m ago",
    ]);
    expect(t.fgOf("CrashLoopBackOff")).toEqual(RGBA.fromHex(t.theme.error));
    await t.enterOn("waiting");
    expect(t.opened).toHaveBeenLastCalledWith(expect.objectContaining({ name: "shop-api-7d9f8-x2k4q" }), {
      eventsOnly: false,
    });
  } finally {
    t.renderer.destroy();
  }
});

test("the Dashboard's warning is marked in its color and gets the cursor: the pod it was about, not one under its name", async () => {
  const gone = warning({ id: "event-old", uid: "pod-1", lastSeen: minutesAgo(30) });
  const t = await renderEventsTab([warning({ id: "event-new", uid: "pod-2" }), gone], {
    removed: ["event-old"],
    target: warningTarget(gone),
  });
  try {
    const rows = t.lines().slice(2);
    expect(rows).toEqual([
      "└─ ▾ shop-test 2",
      "└─ ▾ BackOff 2",
      "├─ shop-api-7d9f8-x2k4q 2m ago",
      "└─ shop-api-7d9f8-x2k4q (cached) 30m ago",
    ]);
    // Reload commit is the first stop, then each row: the removed pod is the fourth.
    await t.settle();
    const line = t
      .frame()
      .split("\n")
      .findIndex(text => text.includes("(cached)"));
    const cursorBg = t.captureSpans().lines[line]?.spans.find(span => span.text.includes("x2k4q"))?.bg;
    expect(cursorBg).toEqual(RGBA.fromHex(t.theme.backgroundElementActive));
  } finally {
    t.renderer.destroy();
  }
});

test("the Dashboard's warning marks its warning row, not the status's red row with the same reason", async () => {
  const backOff = warning({ id: "event-1", uid: "pod-1" });
  const status: OpenShiftFailure = { ...backOff, id: "status:backoff", lastSeen: null, status: "waiting" };
  const t = await renderEventsTab([backOff], { failures: [status], target: warningTarget(backOff) });
  try {
    expect(t.lines().slice(2)).toEqual([
      "└─ ▾ shop-test 2",
      "├─ ▾ BackOff 1",
      "│ └─ shop-api-7d9f8-x2k4q waiting",
      "└─ ▾ BackOff 1",
      "└─ shop-api-7d9f8-x2k4q 2m ago",
    ]);
    const frame = t.frame().split("\n");
    const bgOf = (text: string) =>
      t
        .captureSpans()
        .lines[frame.findIndex(line => line.includes(text))]?.spans.find(span => span.text.includes("x2k4q"))?.bg;
    expect(bgOf("2m ago")).toEqual(RGBA.fromHex(t.theme.backgroundElementActive));
    expect(bgOf("waiting")).not.toEqual(RGBA.fromHex(t.theme.backgroundElementActive));
  } finally {
    t.renderer.destroy();
  }
});

test("the Dashboard's warning under a closed reason or namespace opens them to show its row", async () => {
  const backOff = warning({ id: "event-1", uid: "pod-1" });
  const t = await renderEventsTab([backOff, warning({ id: "event-2", reason: "Unhealthy" })], {
    target: warningTarget(backOff),
    collapsed: [namespaceKey("shop-test"), reasonKey("shop-test", "BackOff")],
  });
  try {
    expect(t.lines().slice(2)).toEqual([
      "└─ ▾ shop-test 2",
      "├─ ▾ BackOff 1",
      "│ └─ shop-api-7d9f8-x2k4q 2m ago",
      "└─ ▾ Unhealthy 1",
      "└─ shop-api-7d9f8-x2k4q 2m ago",
    ]);
  } finally {
    t.renderer.destroy();
  }
});
