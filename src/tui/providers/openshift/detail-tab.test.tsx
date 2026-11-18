import { expect, mock, spyOn, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import * as browser from "../../../adapters/system/open-url";
import { resourceFromWatchObject } from "../../../core/openshift/resources";
import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";
import { createDetailMemory, type DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import { OpenShiftDetailTab } from "./detail-tab";

const SHA = "a".repeat(40);
const CONSOLE = "https://console.example.com";

export const resource = (
  kind: OpenShiftResource["kind"],
  name: string,
  extra: Partial<OpenShiftResource> = {},
): OpenShiftResource => ({
  id: `${kind}/${name}`,
  kind,
  namespace: "payments-dev",
  name,
  status: "pass",
  imageRefs: [],
  ...extra,
});

export async function renderOpenShiftTab(
  opts: Readonly<{
    pods?: OpenShiftResource[];
    builds?: OpenShiftResource[];
    deployments?: OpenShiftResource[];
    consoleUrl?: string;
    width?: number;
    memory?: DetailMemory;
    /** The dashboard's event: a build to mark, and its color. */
    targetResourceId?: string;
    targetColor?: string;
    warnings?: OpenShiftWarning[];
  }> = {},
) {
  const data: OpenShiftCommitData = {
    sha: SHA,
    liveFetched: true,
    namespaces: [
      {
        namespace: "payments-dev",
        builds: opts.builds ?? [],
        imageStreamTags: [],
        deployments: opts.deployments ?? [],
        deploymentConfigs: [],
        pods: opts.pods ?? [resource("Pod", "payments-api-7f9c-x2k4")],
      },
    ],
    ...(opts.warnings ? { warnings: opts.warnings } : {}),
  };
  const [cursor, setCursor] = createSignal(0);
  /** Off and on again: what a tab switch or a switch between the two layouts does to the tab. */
  const [mounted, setMounted] = createSignal(true);
  const [consoleUrl, setConsoleUrl] = createSignal(opts.consoleUrl ?? CONSOLE);
  const shortcut = mock((_shortcut: { key: string; desc: string } | null) => {});
  const navRef: DetailNavRef = {
    itemCount: 0,
    itemRefs: [],
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
  };
  const width = opts.width ?? 70;
  const theme = createThemeState();
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <box width={width} flexDirection="column">
          <Show when={mounted()}>
            <OpenShiftDetailTab
              sha={SHA}
              getCommitData={() => data}
              consoleUrl={consoleUrl}
              navRef={navRef}
              memory={opts.memory}
              detailCursorIndex={cursor}
              detailFocused={() => true}
              setDetailCursorAction={() => {}}
              setDetailCursorIndex={setCursor}
              setDetailCursorShortcut={shortcut}
              targetResourceId={opts.targetResourceId}
              targetColor={opts.targetColor}
            />
          </Show>
        </box>
      </ThemeContext.Provider>
    ),
    { width: width + 4, height: 24 },
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
  };
  await settle();
  const press = (name: string) => navRef.handleKey?.({ name, ctrl: false, meta: false } as KeyEvent) ?? false;
  const row = (text: string) =>
    setup
      .captureCharFrame()
      .split("\n")
      .find(line => line.includes(text)) ?? "";
  return {
    ...setup,
    navRef,
    shortcut,
    cursor,
    setCursor,
    setMounted,
    setConsoleUrl,
    settle,
    press,
    row,
    theme: theme.theme(),
  };
}

test("o opens the selected namespace or resource in the web console, only when its URL is set", async () => {
  const openUrl = spyOn(browser, "openUrl").mockImplementation(() => {});
  const t = await renderOpenShiftTab();
  try {
    expect(t.press("o")).toBe(false);
    t.setCursor(1);
    await t.settle();
    expect(t.shortcut).toHaveBeenLastCalledWith({ key: "o", desc: "open" });
    expect(t.press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(`${CONSOLE}/k8s/cluster/projects/payments-dev`);
    t.setCursor(2);
    await t.settle();
    expect(t.press("o")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith(`${CONSOLE}/k8s/ns/payments-dev/pods/payments-api-7f9c-x2k4`);
    t.setConsoleUrl("");
    await t.settle();
    expect(t.shortcut).toHaveBeenLastCalledWith(null);
    expect(t.press("o")).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(2);
  } finally {
    openUrl.mockRestore();
    t.renderer.destroy();
  }
});

// A crash-looping Pod read the way the live list reads it.
const crashing = resourceFromWatchObject(
  {
    kind: "Pod",
    metadata: { name: "payments-api-7f9c-x2k4", namespace: "payments-dev" },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "api",
          restartCount: 14,
          state: { waiting: { reason: "CrashLoopBackOff" } },
          lastState: { terminated: { reason: "Error", exitCode: 1 } },
        },
      ],
    },
  },
  "payments-dev/commit-sha",
) as OpenShiftResource;

test("a failing row shows only its name and ✗; why it fails is in the resource dialog", async () => {
  expect(crashing.status).toBe("fail");
  const t = await renderOpenShiftTab({ pods: [crashing], width: 70 });
  try {
    expect(t.row("payments-api").replace(/\s+/g, " ")).toMatch(/payments-api-7f9c-x2k4 ✗/);
    expect(t.captureCharFrame()).not.toMatch(/CrashLoop|exit 1|restart/);
  } finally {
    t.renderer.destroy();
  }
});

test("a row's muted note gives way before its name", async () => {
  const batch = resource("Deployment", "payments-api-batch-worker", { scaledToZero: true });
  const wide = await renderOpenShiftTab({ pods: [], deployments: [batch], width: 70 });
  try {
    expect(wide.row("payments-api-batch")).toContain("payments-api-batch-worker  0 replicas");
    const y = wide
      .captureCharFrame()
      .split("\n")
      .findIndex(line => line.includes("0 replicas"));
    const note = wide.captureSpans().lines[y]?.spans.find(span => span.text.includes("0 replicas"));
    expect(note?.fg).toEqual(RGBA.fromHex(wide.theme.foregroundMuted));
  } finally {
    wide.renderer.destroy();
  }
  // Narrow: the name stays whole and the note is cut.
  const narrow = await renderOpenShiftTab({ pods: [], deployments: [batch], width: 44 });
  try {
    expect(narrow.row("payments-api-batch")).toContain("payments-api-batch-worker  0");
    expect(narrow.row("payments-api-batch")).toContain("…");
  } finally {
    narrow.renderer.destroy();
  }
});

test("(cached) marks only a Build the cluster no longer lists; a Deployment scaled to 0 says so", async () => {
  const t = await renderOpenShiftTab({
    pods: [],
    builds: [
      resource("Build", "payments-api-41", { status: "fail" }),
      resource("Build", "payments-api-40", { cacheOnly: true }),
    ],
    deployments: [resource("Deployment", "payments-batch", { scaledToZero: true })],
  });
  try {
    expect(t.row("payments-api-41").replace(/\s+/g, " ")).toMatch(/payments-api-41 ✗/);
    expect(t.row("payments-api-40")).toContain("payments-api-40 (cached)");
    expect(t.row("payments-batch")).toContain("payments-batch  0 replicas");
  } finally {
    t.renderer.destroy();
  }
});

test("a healthy row has no note", async () => {
  const t = await renderOpenShiftTab({ pods: [resource("Pod", "payments-api-6d2b-m9w3")] });
  try {
    expect(t.row("payments-api").replace(/\s+/g, " ")).toMatch(/payments-api-6d2b-m9w3 ✓/);
  } finally {
    t.renderer.destroy();
  }
});

test("a namespace closed by the user stays closed, with the cursor on it, when the tab mounts again", async () => {
  const t = await renderOpenShiftTab({ memory: createDetailMemory() });
  try {
    // Reload commit, then the namespace.
    const namespace = 1;
    t.setCursor(namespace);
    await t.settle();
    expect(t.row("payments-dev")).toContain("▾");
    t.navRef.activateCurrentItem();
    await t.settle();
    expect(t.captureCharFrame()).not.toContain("payments-api");
    t.setMounted(false);
    await t.settle();
    t.setMounted(true);
    await t.settle();
    expect(t.row("payments-dev")).toContain("▸");
    expect(t.captureCharFrame()).not.toContain("payments-api");
    expect(t.cursor()).toBe(namespace);
  } finally {
    t.renderer.destroy();
  }
});

test("the dashboard's event: its build is marked in the given color, and the tab's focus starts on it", async () => {
  const tab = await renderOpenShiftTab({
    builds: [resource("Build", "shop-api-42"), resource("Build", "shop-api-43")],
    targetResourceId: "Build/shop-api-43",
    targetColor: "#00ff00",
  });
  try {
    const lines = tab.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes("shop-api-43"));
    const span = (row: number, text: string) =>
      tab.captureSpans().lines[row]?.spans.find(candidate => candidate.text.includes(text));
    // The tab is focused here: the cursor starts on the event's build, which shows the cursor's color.
    expect(tab.cursor()).toBeGreaterThan(0);
    expect(span(y, "shop-api-43")?.fg).toEqual(RGBA.fromHex(tab.theme.accent));
    // The cursor elsewhere: the event's build keeps its mark, the other build its usual color.
    tab.setCursor(0);
    await tab.flush();
    expect(span(y, "shop-api-43")?.fg).toEqual(RGBA.fromHex("#00ff00"));
    const other = lines.findIndex(line => line.includes("shop-api-42"));
    expect(span(other, "shop-api-42")?.fg).toEqual(RGBA.fromHex(tab.theme.foreground));
  } finally {
    tab.renderer.destroy();
  }
});

test("the dashboard's build that arrives after the tab got the keyboard still gets the cursor", async () => {
  const [data, setData] = createSignal<OpenShiftCommitData | null>(null);
  const [cursor, setCursor] = createSignal(0);
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <box width={70} flexDirection="column">
          <OpenShiftDetailTab
            sha={SHA}
            getCommitData={() => data()}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            targetResourceId="Build/shop-api-43"
          />
        </box>
      </ThemeContext.Provider>
    ),
    { width: 74, height: 20 },
  );
  try {
    await setup.flush();
    expect(cursor()).toBe(0);
    setData({
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "payments-dev",
          builds: [resource("Build", "shop-api-43")],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    });
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(0);
      await setup.flush();
    }
    const lines = setup.captureCharFrame().split("\n");
    expect(cursor()).toBeGreaterThan(0);
    expect(lines.find(line => line.includes("shop-api-43"))).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("the dashboard's build gets the cursor once: mounted again (a resize), the tab leaves it where it was moved", async () => {
  const tab = await renderOpenShiftTab({
    builds: [resource("Build", "shop-api-42"), resource("Build", "shop-api-43")],
    targetResourceId: "Build/shop-api-43",
    memory: createDetailMemory(),
  });
  try {
    expect(tab.cursor()).toBeGreaterThan(0);
    tab.setCursor(0);
    await tab.settle();
    tab.setMounted(false);
    await tab.settle();
    tab.setMounted(true);
    await tab.settle();
    expect(tab.cursor()).toBe(0);
  } finally {
    tab.renderer.destroy();
  }
});

test("a resource OpenShift warned about has ! in the warning color before its status, and nothing more", async () => {
  const warning: OpenShiftWarning = {
    id: "event-1",
    namespace: "payments-dev",
    kind: "Pod",
    name: "payments-api-6d2b-m9w3",
    reason: "Unhealthy",
    message: "Readiness probe failed",
    count: 4,
    firstSeen: "2026-03-02T09:16:00Z",
    lastSeen: "2026-03-02T09:20:00Z",
  };
  const t = await renderOpenShiftTab({
    pods: [resource("Pod", "payments-api-6d2b-m9w3"), resource("Pod", "payments-api-6d2b-q1z8")],
    warnings: [warning],
  });
  try {
    expect(t.row("m9w3").replace(/\s+/g, " ").trim()).toMatch(/payments-api-6d2b-m9w3 ! ✓$/);
    expect(t.row("q1z8").replace(/\s+/g, " ").trim()).toMatch(/payments-api-6d2b-q1z8 ✓$/);
    expect(t.captureCharFrame()).not.toMatch(/Unhealthy|Readiness/);
    const y = t
      .captureCharFrame()
      .split("\n")
      .findIndex(line => line.includes("m9w3"));
    const mark = t.captureSpans().lines[y]?.spans.find(span => span.text.includes("!"));
    expect(mark?.fg).toEqual(RGBA.fromHex(t.theme.warning));
  } finally {
    t.renderer.destroy();
  }
});

test("a cancelled build shows ○, neutral like a cancelled CI run", async () => {
  const t = await renderOpenShiftTab({
    pods: [],
    builds: [resource("Build", "payments-api-13", { status: "cancelled" })],
  });
  try {
    expect(t.row("payments-api-13").replace(/\s+/g, " ").trim()).toMatch(/payments-api-13 ○$/);
  } finally {
    t.renderer.destroy();
  }
});

test("a build only the cache has is muted, its (cached) too; its status keeps its color", async () => {
  const t = await renderOpenShiftTab({
    pods: [],
    builds: [resource("Build", "payments-api-40", { cacheOnly: true }), resource("Build", "payments-api-41")],
  });
  try {
    const color = (text: string) => {
      const y = t
        .captureCharFrame()
        .split("\n")
        .findIndex(line => line.includes(text));
      return t.captureSpans().lines[y]?.spans.find(span => span.text.includes(text))?.fg;
    };
    expect(color("payments-api-40")).toEqual(RGBA.fromHex(t.theme.foregroundMuted));
    expect(color("payments-api-41")).toEqual(RGBA.fromHex(t.theme.foreground));
    expect(color("✓")).toEqual(RGBA.fromHex(t.theme.success));
  } finally {
    t.renderer.destroy();
  }
});
