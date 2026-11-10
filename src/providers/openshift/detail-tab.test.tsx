import { expect, mock, spyOn, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as browser from "../../utils/open-url";
import { OpenShiftDetailTab } from "./detail-tab";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";

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
  };
  const [cursor, setCursor] = createSignal(0);
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
          <OpenShiftDetailTab
            sha={SHA}
            getCommitData={() => data}
            consoleUrl={consoleUrl}
            navRef={navRef}
            detailCursorIndex={cursor}
            detailFocused={() => true}
            setDetailCursorAction={() => {}}
            setDetailCursorIndex={setCursor}
            setDetailCursorShortcut={shortcut}
          />
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
  return { ...setup, navRef, shortcut, setCursor, setConsoleUrl, settle, press, row, theme: theme.theme() };
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

const crashing = resource("Pod", "payments-api-7f9c-x2k4", {
  status: "fail",
  reason: "CrashLoopBackOff",
});

test("a failing row says why after its name, muted, and the reason gives way before the name", async () => {
  const wide = await renderOpenShiftTab({ pods: [crashing], width: 70 });
  try {
    expect(wide.row("payments-api")).toContain("payments-api-7f9c-x2k4  CrashLoopBackOff");
    const y = wide
      .captureCharFrame()
      .split("\n")
      .findIndex(line => line.includes("CrashLoop"));
    const reason = wide.captureSpans().lines[y]?.spans.find(span => span.text.includes("CrashLoop"));
    expect(reason?.fg).toEqual(RGBA.fromHex(wide.theme.foregroundMuted));
  } finally {
    wide.renderer.destroy();
  }
  // Narrow: the name stays whole and the reason is cut.
  const narrow = await renderOpenShiftTab({ pods: [crashing], width: 44 });
  try {
    expect(narrow.row("payments-api")).toContain("payments-api-7f9c-x2k4  Crash");
    expect(narrow.row("payments-api")).toContain("…");
    expect(narrow.row("payments-api")).toContain("✗");
  } finally {
    narrow.renderer.destroy();
  }
  // Narrower than the name: only the name, cut.
  const tiny = await renderOpenShiftTab({ pods: [crashing], width: 28 });
  try {
    expect(tiny.row("payments-api")).not.toContain("Crash");
    expect(tiny.row("payments-api")).toContain("✗");
  } finally {
    tiny.renderer.destroy();
  }
});

test("(cached) marks only a Build the cluster no longer lists; a Deployment scaled to 0 says so", async () => {
  const t = await renderOpenShiftTab({
    pods: [],
    builds: [
      resource("Build", "payments-api-41", { status: "fail", reason: "DockerBuildFailed" }),
      resource("Build", "payments-api-40", { cacheOnly: true }),
    ],
    deployments: [resource("Deployment", "payments-batch", { scaledToZero: true })],
  });
  try {
    expect(t.row("payments-api-41")).toContain("payments-api-41  DockerBuildFailed");
    expect(t.row("payments-api-41")).not.toContain("(cached)");
    expect(t.row("payments-api-40")).toContain("payments-api-40 (cached)");
    expect(t.row("payments-batch")).toContain("payments-batch  0 replicas");
  } finally {
    t.renderer.destroy();
  }
});

test("a healthy row has no reason", async () => {
  const t = await renderOpenShiftTab({ pods: [resource("Pod", "payments-api-6d2b-m9w3")] });
  try {
    expect(t.row("payments-api").replace(/\s+/g, " ")).toMatch(/payments-api-6d2b-m9w3 ✓/);
  } finally {
    t.renderer.destroy();
  }
});
