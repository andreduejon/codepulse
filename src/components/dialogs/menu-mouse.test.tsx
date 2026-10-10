import { expect, mock, spyOn, test } from "bun:test";
import { InputRenderable, type Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import * as config from "../../config";
import { AppStateContext, createAppState } from "../../context/state";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as clipboard from "../../hooks/use-clipboard";
import type {
  GitHubMenuConfig,
  JenkinsMenuConfig,
  OpenShiftMenuConfig,
  SnykMenuConfig,
} from "../../hooks/use-menu-items";
import MenuDialog, { lastMenuTab, setLastMenuTab } from "./menu-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderMenu(height = 60) {
  const previousTab = lastMenuTab();
  setLastMenuTab("repository");
  const write = spyOn(config, "writeConfig").mockReturnValue(true);
  const read = spyOn(config, "getRepoDisplayConfig").mockReturnValue({});
  const copy = mock((_text: string, _id: string) => {});
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(() => ({
    copiedId: () => null,
    copyToClipboard: copy,
  }));
  const theme = createThemeState();
  const [open, setOpen] = createSignal(true);
  const [github, setGithub] = createSignal<GitHubMenuConfig>({
    enabled: true,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: null,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
  });
  const close = mock(() => setOpen(false));
  const [jenkins, setJenkins] = createSignal<JenkinsMenuConfig>({
    enabled: true,
    tokenEnvVar: "JENKINS_TOKEN",
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
    jobs: [],
  });
  const [snyk, setSnyk] = createSignal<SnykMenuConfig>({
    enabled: false,
    tokenEnvVar: "SNYK_TOKEN",
    autoScanBranches: [],
    maxCachedScans: 20,
  });
  const [openshift, setOpenShift] = createSignal<OpenShiftMenuConfig>({
    enabled: false,
    serverUrl: "",
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: [],
    commitShaAnnotation: "dev/commit-sha",
    cacheLimit: 20,
    fetchDepth: 20,
    autoRefreshSeconds: 120,
  });
  const fetch = mock(() => {});
  const reload = mock(() => {});
  const dialog = mock((_id: "theme") => {});
  const branch = mock((_name: string | null) => {});
  let app!: ReturnType<typeof createAppState>;
  const setup = await testRender(
    () => {
      app = createAppState(100, 0, 0);
      app.actions.setRepoPath("/repo/menu-mouse");
      app.actions.setRemoteUrl("https://github.com/owner/menu-mouse.git");
      app.actions.setCurrentBranch("main");
      app.actions.setBranches([
        { name: "main", isCurrent: true, isRemote: false, lastCommitHash: "abc" },
        { name: "feature-mouse", isCurrent: false, isRemote: false, lastCommitHash: "def" },
      ]);
      return (
        <ThemeContext.Provider value={theme}>
          <AppStateContext.Provider value={app}>
            <Show when={open()}>
              <MenuDialog
                onClose={close}
                onReload={reload}
                onFetch={fetch}
                onOpenDialog={dialog}
                onViewBranch={branch}
                githubConfig={github()}
                onGithubConfigChange={setGithub}
                jenkinsConfig={jenkins()}
                onJenkinsConfigChange={setJenkins}
                snykConfig={snyk()}
                onSnykConfigChange={setSnyk}
                openshiftConfig={openshift()}
                onOpenShiftConfigChange={setOpenShift}
              />
            </Show>
          </AppStateContext.Provider>
        </ThemeContext.Provider>
      );
    },
    { width: 110, height, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  const point = (label: string) => {
    const lines = setup.captureCharFrame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y].indexOf(label) + 1, y };
  };
  const span = (label: string) => setup.captureSpans().lines[point(label).y]?.spans.find(s => s.text.includes(label));
  const colorAt = (x: number, y: number) => {
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(s => {
      column += s.text.length;
      return column > x;
    })?.fg;
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
    offset = 0,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y + offset, button);
    await setup.flush();
  };
  const move = async (label?: string, offset = 0) => {
    const { x, y } = label ? point(label) : { x: 0, y: 0 };
    await setup.mockMouse.moveTo(x, y + offset);
    await setup.flush();
  };
  const key = async (name: Parameters<typeof setup.mockInput.pressKey>[0]) => {
    setup.mockInput.pressKey(name);
    await setup.flush();
  };
  const input = () =>
    descendants(setup.renderer.root).find(n => n instanceof InputRenderable) as InputRenderable | undefined;
  await setup.flush();
  return {
    ...setup,
    app,
    theme: theme.theme(),
    write,
    copy,
    close,
    fetch,
    reload,
    dialog,
    branch,
    github,
    jenkins,
    snyk,
    openshift,
    point,
    span,
    colorAt,
    click,
    move,
    key,
    input,
    dispose: () => {
      setup.renderer.destroy();
      clipboardSpy.mockRestore();
      read.mockRestore();
      write.mockRestore();
      setLastMenuTab(previousTab);
    },
  };
}

test("menu tabs hover across all three rows and switch by left click; keyboard tabs still work", async () => {
  const m = await renderMenu();
  try {
    const providers = m.point("Providers");
    for (const offset of [-1, 0, 1]) {
      await m.move("Providers", offset);
      expect(m.span("Providers")?.fg).toEqual(RGBA.fromHex(m.theme.foreground));
      expect(m.colorAt(providers.x, providers.y - 1)).toEqual(RGBA.fromHex(m.theme.foreground));
      expect(m.span("Repository")?.fg).toEqual(RGBA.fromHex(m.theme.accent));
      await m.move();
      expect(m.span("Providers")?.fg).toEqual(RGBA.fromHex(m.theme.foregroundMuted));
      expect(m.colorAt(providers.x, providers.y - 1)).toEqual(RGBA.fromHex(m.theme.border));
      await m.click("Providers", MouseButtons.RIGHT, offset);
      expect(lastMenuTab()).toBe("repository");
      await m.click("Providers", MouseButtons.LEFT, offset);
      expect(lastMenuTab()).toBe("providers");
      expect(m.span("Providers")?.fg).toEqual(RGBA.fromHex(m.theme.accent));
      expect(m.colorAt(providers.x, providers.y - 1)).toEqual(RGBA.fromHex(m.theme.accent));
      await m.click("Repository", MouseButtons.LEFT, offset);
    }
    await m.key("ARROW_RIGHT");
    expect(lastMenuTab()).toBe("branch");
    await m.key("ARROW_LEFT");
    expect(lastMenuTab()).toBe("repository");
  } finally {
    m.dispose();
  }
});

test("menu row hover never selects; clicks share copy, action, dialog, toggle, cycle, section and branch dispatch", async () => {
  const m = await renderMenu();
  try {
    const origin = "https://github.com/owner/menu-mouse.git";
    const highlight = RGBA.fromHex(m.theme.backgroundElement);
    for (const label of [
      "Group",
      "Fetch remote",
      "Color theme",
      "Page size",
      "Show all branches",
      "/repo/menu-mouse",
    ]) {
      await m.move(label);
      expect(m.span(label)?.bg).toEqual(highlight);
      expect(m.span(origin)?.fg).toEqual(RGBA.fromHex(m.theme.accent));
      expect(m.input()).toBeUndefined();
      await m.move();
      expect(m.span(label)?.bg).not.toEqual(highlight);
    }
    await m.click("Origin");
    expect(m.copy).not.toHaveBeenCalled();
    await m.click("Fetch remote", MouseButtons.RIGHT);
    expect(m.fetch).not.toHaveBeenCalled();
    await m.click("Fetch remote");
    expect(m.fetch).toHaveBeenCalledTimes(1);
    await m.key("RETURN");
    expect(m.fetch).toHaveBeenCalledTimes(2);
    await m.click("/repo/menu-mouse");
    expect(m.copy).toHaveBeenLastCalledWith("/repo/menu-mouse", "Directory");
    await m.click("Color theme");
    expect(m.dialog).toHaveBeenLastCalledWith("theme");
    await m.click("Show all branches");
    expect(m.app.state.showAllBranches()).toBe(false);
    await m.click("Page size");
    expect(m.app.state.maxCount()).not.toBe(100);
    expect(m.reload).toHaveBeenCalledTimes(2);
    expect(m.write).toHaveBeenCalledTimes(2);
    await m.click("Providers");
    for (const label of ["GitHub Actions", "Last refresh", "Allow host"]) {
      await m.move(label);
      expect(m.span(label)?.bg).not.toEqual(highlight);
      await m.click(label);
      expect(m.input()).toBeUndefined();
      expect(m.write).toHaveBeenCalledTimes(2);
    }
    await m.click("Cache count");
    expect(m.github().cacheLimit).toBe(50);
    await m.click("Enabled");
    expect(m.github().enabled).toBe(false);
    await m.click("Branches");
    for (const label of ["Checked Out", "main", "Clear filter"]) {
      await m.click(label);
      expect(m.branch).not.toHaveBeenCalled();
      expect(m.close).not.toHaveBeenCalled();
    }
    await m.move("feature-mouse");
    expect(m.span("feature-mouse")?.bg).toEqual(highlight);
    expect(m.span("feature-mouse")?.fg).toEqual(RGBA.fromHex(m.theme.foreground));
    await m.move();
    expect(m.span("feature-mouse")?.bg).not.toEqual(highlight);
    await m.click("Local");
    expect(m.captureCharFrame()).not.toContain("feature-mouse");
    await m.key("RETURN");
    expect(m.captureCharFrame()).toContain("feature-mouse");
    await m.click("feature-mouse");
    expect(m.branch).toHaveBeenLastCalledWith("feature-mouse");
    expect(m.close).toHaveBeenCalledTimes(1);
  } finally {
    m.dispose();
  }
});

test("menu editable clicks preserve caret and drafts, save before navigation, reject invalid drafts and cancel before close", async () => {
  const m = await renderMenu();
  try {
    await m.click("Group");
    const input = m.input();
    if (!input) throw new Error("Clicking Group must create a native input");
    expect(input?.focused).toBe(true);
    await m.mockInput.typeText("draft");
    await m.flush();
    await m.move("App name");
    expect(m.input()).toBe(input);
    expect(input?.focused).toBe(true);
    expect(input?.value).toBe("draft");
    await m.mockMouse.click(input.x + 1, input.y);
    await m.flush();
    expect(m.input()).toBe(input);
    expect(input?.value).toBe("draft");
    expect(input?.cursorOffset).toBe(1);
    await m.click("Group");
    expect(input?.value).toBe("draft");
    expect(m.write).not.toHaveBeenCalled();
    await m.click("App name");
    expect(m.write).toHaveBeenLastCalledWith(expect.objectContaining({ group: "draft" }), "/repo/menu-mouse");
    expect(m.input()?.value).toBe("");
    await m.mockInput.typeText("mouse app");
    await m.flush();
    await m.click("Providers");
    expect(m.write).toHaveBeenLastCalledWith(expect.objectContaining({ appName: "mouse app" }), "/repo/menu-mouse");
    expect(lastMenuTab()).toBe("providers");
    expect(m.input()).toBeUndefined();
    await m.click("Repository");
    await m.click("Group");
    await m.key("END");
    await m.mockInput.typeText("x".repeat(65));
    await m.flush();
    const invalid = m.input();
    const draft = invalid?.value;
    const writes = m.write.mock.calls.length;
    await m.click("Fetch remote");
    expect(m.fetch).not.toHaveBeenCalled();
    expect(m.input()).toBe(invalid);
    await m.click("Providers");
    expect(lastMenuTab()).toBe("repository");
    expect(m.input()?.value).toBe(draft);
    expect(m.write).toHaveBeenCalledTimes(writes);
    await m.click("esc cancel", MouseButtons.RIGHT);
    expect(m.input()).toBe(invalid);
    await m.click("esc cancel");
    expect(m.input()).toBeUndefined();
    expect(m.close).not.toHaveBeenCalled();
    expect(m.write).toHaveBeenCalledTimes(writes);
    await m.click("Group");
    expect(m.input()?.value).toBe("draft");
    await m.key("ESCAPE");
    expect(m.input()).toBeUndefined();
    await m.key("RETURN");
    expect(m.input()?.focused).toBe(true);
    await m.key("END");
    await m.mockInput.typeText(" saved");
    await m.key("RETURN");
    expect(m.write).toHaveBeenLastCalledWith(expect.objectContaining({ group: "draft saved" }), "/repo/menu-mouse");
    expect(m.input()).toBeUndefined();
    await m.click("Group");
    await m.mockInput.typeText(" abandoned");
    await m.flush();
    await m.click("Fetch remote");
    expect(m.write).toHaveBeenCalledTimes(writes + 2);
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(m.input()).toBeUndefined();
    await m.click("esc close");
    expect(m.close).toHaveBeenCalledTimes(1);
  } finally {
    m.dispose();
  }
});

test("menu footer Enter activates, starts editing and saves; Escape cancels without closing or writing", async () => {
  const m = await renderMenu(100);
  try {
    await m.click("Fetch remote");
    expect(m.fetch).toHaveBeenCalledTimes(1);
    await m.move("enter confirm");
    await m.click("enter confirm", MouseButtons.RIGHT);
    expect(m.fetch).toHaveBeenCalledTimes(1);
    await m.click("enter confirm");
    expect(m.fetch).toHaveBeenCalledTimes(2);

    await m.click("Group");
    await m.click("esc cancel");
    expect(m.input()).toBeUndefined();
    expect(m.close).not.toHaveBeenCalled();
    await m.move("enter edit");
    await m.click("enter edit", MouseButtons.RIGHT);
    expect(m.input()).toBeUndefined();
    await m.click("enter edit");
    expect(m.input()?.focused).toBe(true);
    await m.mockInput.typeText("footer group");
    await m.flush();
    const draft = m.input();
    await m.move("enter save");
    await m.click("enter save", MouseButtons.RIGHT);
    expect(m.input()).toBe(draft);
    expect(m.input()?.value).toBe("footer group");
    expect(m.write).not.toHaveBeenCalled();
    await m.click("enter save");
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.write).toHaveBeenLastCalledWith(expect.objectContaining({ group: "footer group" }), "/repo/menu-mouse");
    expect(m.input()).toBeUndefined();
    expect(m.app.state.keyboardScopeOverride()).toBeNull();

    await m.click("enter edit");
    await m.key("END");
    await m.mockInput.typeText(" abandoned");
    await m.flush();
    const abandoned = m.input();
    await m.move("esc cancel");
    await m.click("esc cancel", MouseButtons.RIGHT);
    expect(m.input()).toBe(abandoned);
    expect(m.input()?.value).toBe("footer group abandoned");
    expect(m.write).toHaveBeenCalledTimes(1);
    await m.click("esc cancel");
    expect(m.input()).toBeUndefined();
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.close).not.toHaveBeenCalled();
    await m.click("enter edit");
    expect(m.input()?.value).toBe("footer group");
    await m.click("esc cancel");

    await m.click("Providers");
    await m.click("New job");
    await m.click("esc cancel");
    await m.click("enter edit");
    expect(m.input()?.focused).toBe(true);
    await m.click("enter save");
    expect(m.input()?.value).toBe("");
    expect(m.write).toHaveBeenCalledTimes(1);
    const url = "https://jenkins.example.com/job/footer/";
    await m.mockInput.typeText(url);
    await m.flush();
    await m.click("enter save");
    expect(m.jenkins().jobs).toEqual([{ url }]);
    expect(m.write).toHaveBeenCalledTimes(2);
    expect(m.input()).toBeUndefined();
    expect(m.span("New job")?.fg).toEqual(RGBA.fromHex(m.theme.accent));
    await m.click("enter edit");
    expect(m.input()?.value).toBe("");
    await m.mockInput.typeText("https://jenkins.example.com/job/abandoned/");
    await m.flush();
    await m.click("esc cancel");
    expect(m.jenkins().jobs).toEqual([{ url }]);
    expect(m.write).toHaveBeenCalledTimes(2);
    expect(m.input()).toBeUndefined();
    expect(m.close).not.toHaveBeenCalled();
  } finally {
    m.dispose();
  }
});

test("saving an inserting provider draft keeps the clicked target, including repeated row labels", async () => {
  const m = await renderMenu(100);
  try {
    await m.click("Providers");
    await m.click("New job");
    await m.mockInput.typeText("https://jenkins.example.com/job/mouse/");
    await m.flush();
    const { x, y } = m.point("Snyk");
    await m.mockMouse.click(x, y + 1);
    await m.flush();
    expect(m.jenkins().jobs).toEqual([{ url: "https://jenkins.example.com/job/mouse/" }]);
    expect(m.snyk().enabled).toBe(true);
    expect(m.github().enabled).toBe(true);
    expect(m.jenkins().enabled).toBe(true);
    expect(m.input()).toBeUndefined();
    await m.key("RETURN");
    expect(m.snyk().enabled).toBe(false);
  } finally {
    m.dispose();
  }
});

test("Enter saves provider additions once, exits input, retains selection and supports repeated editing", async () => {
  const m = await renderMenu(100);
  try {
    await m.click("Providers");
    for (const provider of [
      {
        label: "New job",
        values: ["https://jenkins.example.com/job/first/", "https://jenkins.example.com/job/second/"],
        entries: () => m.jenkins().jobs.map(job => job.url),
      },
      {
        enable: "OpenShift",
        label: "New namespace",
        values: ["first-namespace", "second-namespace"],
        entries: () => m.openshift().namespaces,
      },
      {
        enable: "Snyk",
        label: "New branch",
        values: ["main", "feature-mouse"],
        entries: () => m.snyk().autoScanBranches,
      },
    ]) {
      if (provider.enable) await m.click(provider.enable, MouseButtons.LEFT, 1);
      await m.click(provider.label);
      await m.move();
      const writes = m.write.mock.calls.length;
      for (const [index, value] of provider.values.entries()) {
        await m.mockInput.typeText(value);
        await m.flush();
        expect(m.input()?.value).toBe(value);
        await m.key("RETURN");
        expect(provider.entries()).toEqual(provider.values.slice(0, index + 1));
        expect(m.write).toHaveBeenCalledTimes(writes + index + 1);
        expect(m.input()).toBeUndefined();
        expect(m.app.state.keyboardScopeOverride()).toBeNull();
        expect(m.span(provider.label)?.fg).toEqual(RGBA.fromHex(m.theme.accent));
        await m.key("RETURN");
        expect(m.input()?.focused).toBe(true);
        expect(m.input()?.value).toBe("");
        // Empty additions remain in edit mode and must not persist again.
        const input = m.input();
        await m.key("RETURN");
        expect(m.input()).toBe(input);
        expect(m.write).toHaveBeenCalledTimes(writes + index + 1);
      }
      await m.mockInput.typeText("invalid value");
      await m.flush();
      const invalid = m.input();
      await m.key("RETURN");
      expect(m.input()).toBe(invalid);
      expect(m.input()?.value).toBe("invalid value");
      expect(provider.entries()).toEqual(provider.values);
      expect(m.write).toHaveBeenCalledTimes(writes + 2);
      await m.key("ESCAPE");
      expect(m.input()).toBeUndefined();
      expect(m.close).not.toHaveBeenCalled();
      await m.key("RETURN");
      expect(m.input()?.value).toBe("");
      await m.key("ESCAPE");
    }
  } finally {
    m.dispose();
  }
});

test("menu native wheel scrolls without selecting or activating; keyboard navigation and Escape are unchanged", async () => {
  const m = await renderMenu(30);
  try {
    const scrollbox = descendants(m.renderer.root).find(n => n instanceof ScrollBoxRenderable) as ScrollBoxRenderable;
    const { x, y } = m.point("/repo/menu-mouse");
    await m.mockMouse.scroll(x, y, "down");
    await m.flush();
    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(m.copy).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
    expect(m.input()).toBeUndefined();
    // Wheel scrolling leaves the original Origin cursor intact.
    await m.key("RETURN");
    expect(m.copy).toHaveBeenLastCalledWith("https://github.com/owner/menu-mouse.git", "URL");
    await m.key("ARROW_DOWN");
    await m.key("RETURN");
    expect(m.copy).toHaveBeenLastCalledWith("/repo/menu-mouse", "Directory");
    await m.key("ARROW_DOWN");
    expect(m.input()).toBeUndefined();
    await m.key("RETURN");
    expect(m.input()?.focused).toBe(true);
    await m.key("ESCAPE");
    expect(m.close).not.toHaveBeenCalled();
    await m.key("ESCAPE");
    expect(m.close).toHaveBeenCalledTimes(1);
  } finally {
    m.dispose();
  }
});
