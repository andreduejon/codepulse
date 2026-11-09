import { expect, mock, spyOn, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
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
  opts: Readonly<{ pods?: OpenShiftResource[]; consoleUrl?: string; width?: number }> = {},
) {
  const data: OpenShiftCommitData = {
    sha: SHA,
    liveFetched: true,
    namespaces: [
      {
        namespace: "payments-dev",
        builds: [],
        imageStreamTags: [],
        deployments: [],
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
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
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
  return { ...setup, navRef, shortcut, setCursor, setConsoleUrl, settle, press };
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
