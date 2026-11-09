import { expect, mock, spyOn, test } from "bun:test";
import { type Renderable, RGBA, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createThemeState, ThemeContext } from "../../context/theme";
import * as browser from "../../utils/open-url";
import JobLogDialog from "./log-dialog";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);

async function renderLog(provider: "github-actions" | "jenkins", long: boolean | "wrapped" = false) {
  const jobs = [
    { id: 1, name: "first-job" },
    { id: 2, name: "empty-job" },
    { id: 3, name: "failed-job" },
  ];
  let resolveLog!: (text: string) => void;
  const pending = new Promise<string>(resolve => (resolveLog = resolve));
  const raw =
    long === "wrapped"
      ? Array.from({ length: 40 }, (_, i) => `line-${i + 1} ${"word ".repeat(40)}END-${i + 1}`).join("\n")
      : long
        ? Array.from({ length: 200 }, (_, i) => `row-${String(i + 1).padStart(3, "0")}`).join("\n")
        : [`normal ${"x".repeat(100)} WRAP-END`, "##[warning]warning-line", "##[error]error-line", "##[endgroup]"].join(
            "\n",
          );
  const fetchLog = mock(async (job: { id: string | number; name: string }) => {
    if (job.id === 1) return long ? raw : pending;
    if (job.id === 2) return "";
    throw new Error("fake failure");
  });
  const openUrl = spyOn(browser, "openUrl").mockImplementation(() => {});
  const theme = createThemeState();
  const [open, setOpen] = createSignal(true);
  const [url, setUrl] = createSignal<string | undefined>("https://example.com/run/42");
  const close = mock(() => setOpen(false));
  const searchActive = mock((_active: boolean) => {});
  let setup: Awaited<ReturnType<typeof testRender>>;
  try {
    setup = await testRender(
      () => (
        <ThemeContext.Provider value={theme}>
          <Show when={open()}>
            <JobLogDialog
              provider={provider}
              job={jobs[0]}
              jobs={jobs}
              run={{ name: "Build", runNumber: 42, url: url() }}
              fetchLog={fetchLog}
              onClose={close}
              onSearchActive={searchActive}
            />
          </Show>
        </ThemeContext.Provider>
      ),
      { width: 80, height: 30, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
    );
    await setup.flush();
  } catch (error) {
    openUrl.mockRestore();
    throw error;
  }
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
    const rows = frame().split("\n");
    const y = rows.findIndex(row => row.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: rows[y].indexOf(label) + 1, y };
  };
  const cell = (label: string) => {
    const { x, y } = point(label);
    let column = 0;
    return setup.captureSpans().lines[y]?.spans.find(span => {
      column += span.text.length;
      return column > x;
    });
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const move = async (label?: string) => {
    const { x, y } = label ? point(label) : { x: 0, y: 0 };
    await setup.mockMouse.moveTo(x, y);
    await setup.flush();
  };
  const key = async (
    name: Parameters<typeof setup.mockInput.pressKey>[0],
    modifiers?: Parameters<typeof setup.mockInput.pressKey>[1],
  ) => {
    setup.mockInput.pressKey(name, modifiers);
    await setup.flush();
  };
  const scrollbox = () => {
    const node = descendants(setup.renderer.root).find(node => node instanceof ScrollBoxRenderable);
    if (!(node instanceof ScrollBoxRenderable)) throw new Error("Expected log scrollbox");
    return node;
  };
  return {
    ...setup,
    frame,
    cell,
    click,
    move,
    key,
    scrollbox,
    fetchLog,
    openUrl,
    close,
    searchActive,
    open,
    setOpen,
    setUrl,
    theme: theme.theme(),
    resolve: () => resolveLog(raw),
    dispose: async () => {
      try {
        await setup.dispose();
      } finally {
        openUrl.mockRestore();
      }
    },
  };
}

for (const provider of ["github-actions", "jenkins"] as const) {
  test(`${provider}: mouse/keyboard actions, hover, guarded navigation and terminal log cache`, async () => {
    const d = await renderLog(provider);
    try {
      expect(d.frame()).toContain(provider === "jenkins" ? "Jenkins" : "GitHub Actions");
      expect(d.frame()).toContain("fetching log...");
      expect(d.fetchLog.mock.calls.map(([job]) => job.id)).toEqual([1]);
      const footer = descendants(d.renderer.root).filter(
        node => node instanceof TextRenderable && ["c view", "w wrap", "o open", " · ", "↑/↓"].includes(node.plainText),
      ) as TextRenderable[];
      expect(footer.length).toBeGreaterThan(0);
      expect(footer.every(node => !node.selectable)).toBe(true);
      for (const label of ["next", "open", "view", "wrap", "close"]) {
        await d.move();
        const bg = d.cell(label)?.bg;
        await d.move(label);
        expect(d.cell(label)?.fg).toEqual(RGBA.fromHex(d.theme.foreground));
        expect(d.cell(label)?.bg).toEqual(bg);
        await d.move();
        expect(d.cell(label)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
        const before = d.frame();
        await d.click(label, MouseButtons.RIGHT);
        expect(d.frame()).toBe(before);
      }
      expect(d.openUrl).not.toHaveBeenCalled();
      expect(d.close).not.toHaveBeenCalled();
      const boundary = async (label: string, key: "ARROW_LEFT" | "ARROW_RIGHT", alias: "h" | "l") => {
        await d.move();
        const before = d.frame();
        const bg = d.cell(label)?.bg;
        const arrow = descendants(d.renderer.root).find(
          node => node instanceof TextRenderable && node.plainText === (label === "prev" ? "←" : "→"),
        ) as TextRenderable;
        expect(arrow.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
        await d.move(label);
        expect(d.cell(label)?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
        expect(d.cell(label)?.bg).toEqual(bg);
        await d.click(label);
        await d.key(key);
        await d.key(alias);
        expect(d.frame()).toBe(before);
      };
      await boundary("prev", "ARROW_LEFT", "h");
      await d.click("→ next");
      expect(d.frame()).toContain("No log output.");
      await d.key("h");
      expect(d.frame()).toContain("fetching log...");
      expect(d.fetchLog.mock.calls.map(([job]) => job.id)).toEqual([1, 2]);
      d.resolve();
      await d.flush();
      expect(d.frame()).toContain("normal");
      expect(d.frame()).toContain("warning-line");
      expect(d.frame()).toContain("error-line");
      expect(d.frame()).not.toContain("WRAP-END");
      await d.click("c view");
      expect(d.frame()).toContain("issues only");
      expect(d.frame()).not.toContain("normal");
      expect(d.frame()).toContain("warning-line");
      await d.key("c");
      expect(d.frame()).toContain("errors only");
      expect(d.frame()).not.toContain("warning-line");
      expect(d.frame()).toContain("error-line");
      await d.click("c view");
      expect(d.frame()).toContain("raw");
      expect(d.frame()).toContain("##[endgroup]");
      await d.key("c");
      expect(d.frame()).toContain("normal");
      expect(d.frame()).not.toContain("##[endgroup]");
      await d.click("w wrap");
      expect(d.frame()).toContain("WRAP-END");
      expect(d.frame()).toContain("w nowrap");
      await d.key("w");
      expect(d.frame()).not.toContain("WRAP-END");
      expect(d.frame()).toContain("w wrap");
      await d.click("o open");
      await d.key("o");
      expect(d.openUrl.mock.calls).toEqual([["https://example.com/run/42"], ["https://example.com/run/42"]]);
      d.setUrl(undefined);
      await d.flush();
      expect(d.frame()).not.toContain("o open");
      await d.key("o");
      expect(d.openUrl).toHaveBeenCalledTimes(2);
      await d.key("l");
      expect(d.frame()).toContain("No log output.");
      await d.key("ARROW_RIGHT");
      expect(d.frame()).toContain("Failed to load log");
      expect(d.frame()).toContain("fake failure");
      await boundary("next", "ARROW_RIGHT", "l");
      await d.click("← prev");
      await d.key("ARROW_LEFT");
      expect(d.frame()).toContain("normal");
      await d.click("→ next");
      await d.click("→ next");
      await d.key("c");
      await d.key("w");
      expect(d.fetchLog.mock.calls.map(([job]) => job.id)).toEqual([1, 2, 3]);
      await d.click("esc close");
      expect(d.open()).toBe(false);
      expect(d.close).toHaveBeenCalledTimes(1);
      d.setOpen(true);
      await d.flush();
      await d.key("ESCAPE");
      expect(d.open()).toBe(false);
      expect(d.close).toHaveBeenCalledTimes(2);
    } finally {
      await d.dispose();
    }
  });
}

test("native wheel and keyboard use the same scroll position, including jumps and job/view resets", async () => {
  const d = await renderLog("github-actions", true);
  try {
    const sb = d.scrollbox();
    expect(d.frame()).toContain("row-001");
    for (let i = 0; i < 12; i++) await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "down");
    await d.flush();
    expect(sb.scrollTop).toBeGreaterThan(10);
    expect(d.frame()).not.toContain("row-001");
    const wheelTop = sb.scrollTop;
    await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "up");
    await d.flush();
    expect(sb.scrollTop).toBeLessThan(wheelTop);
    const top = sb.scrollTop;
    await d.key("j");
    expect(sb.scrollTop).toBe(top + 1);
    await d.key("k");
    expect(sb.scrollTop).toBe(top);
    await d.key("ARROW_DOWN", { shift: true });
    expect(sb.scrollTop).toBe(top + 10);
    await d.key("ARROW_UP", { shift: true });
    expect(sb.scrollTop).toBe(top);
    await d.key("g", { shift: true });
    expect(d.frame()).toContain("row-200");
    await d.key("g");
    expect(sb.scrollTop).toBe(0);
    // The old signal stayed at zero here, so g after a wheel could be a no-op.
    await d.mockMouse.scroll(sb.x + 8, sb.y + 2, "down");
    await d.flush();
    expect(sb.scrollTop).toBeGreaterThan(0);
    await d.key("g");
    expect(sb.scrollTop).toBe(0);
    await d.key("j");
    await d.click("c view");
    expect(sb.scrollTop).toBe(0);
    await d.key("c");
    await d.key("c");
    await d.key("c");
    await d.key("j");
    await d.click("→ next");
    expect(sb.scrollTop).toBe(0);
    await d.click("← prev");
    expect(sb.scrollTop).toBe(0);
    expect(d.frame()).toContain("row-001");
    expect(d.fetchLog.mock.calls.map(([job]) => job.id)).toEqual([1, 2]);
  } finally {
    await d.dispose();
  }
});

test("with wrap on, G and repeated down reach the last wrapped row", async () => {
  const d = await renderLog("github-actions", "wrapped");
  try {
    await d.key("w");
    await d.key("g", { shift: true });
    expect(d.frame()).toContain("END-40");
    await d.key("g");
    expect(d.frame()).not.toContain("END-40");
    for (let i = 0; i < 20; i++) await d.key("ARROW_DOWN", { shift: true });
    expect(d.frame()).toContain("END-40");
  } finally {
    await d.dispose();
  }
});

test("r fetches the current log again, retrying a failure, and warnings use the warning colour", async () => {
  const d = await renderLog("github-actions");
  try {
    await d.key("l");
    await d.key("l");
    expect(d.frame()).toContain("fake failure");
    const calls = d.fetchLog.mock.calls.length;
    await d.key("r");
    expect(d.fetchLog.mock.calls.length).toBe(calls + 1);
    expect(d.frame()).toContain("fake failure");
    await d.click("r refresh");
    expect(d.fetchLog.mock.calls.length).toBe(calls + 2);
  } finally {
    await d.dispose();
  }
});

test("warning lines use the theme's warning colour, not the provider accent", async () => {
  const d = await renderLog("github-actions");
  try {
    d.resolve();
    await d.flush();
    expect(d.cell("warning-line")?.fg).toEqual(RGBA.fromHex(d.theme.warning));
  } finally {
    await d.dispose();
  }
});

test("/ searches the log: typing jumps to hits, n/N cycle them, q types, Esc clears then closes", async () => {
  const d = await renderLog("github-actions");
  try {
    d.resolve();
    await d.flush();
    await d.key("/");
    await d.mockInput.typeText("quiet");
    await d.flush();
    expect(d.close).not.toHaveBeenCalled();
    expect(d.frame()).toContain("/ quiet");
    expect(d.frame()).toContain("0/0");
    for (let i = 0; i < "quiet".length; i++) await d.key("BACKSPACE");
    await d.mockInput.typeText("-line");
    await d.flush();
    expect(d.frame()).toContain("1/2");
    await d.key("RETURN");
    await d.key("n");
    expect(d.frame()).toContain("2/2");
    await d.key("n", { shift: true });
    expect(d.frame()).toContain("1/2");
    expect(d.cell("-line")?.bg).toEqual(RGBA.fromHex(d.theme.accent));
    await d.key("ESCAPE");
    expect(d.frame()).not.toContain("1/2");
    expect(d.close).not.toHaveBeenCalled();
    await d.key("ESCAPE");
    expect(d.close).toHaveBeenCalledTimes(1);
  } finally {
    await d.dispose();
  }
});

test("the search bar sits between empty rows at the same dialog height, is one input bar with its count, and the current hit's number is inverted", async () => {
  const d = await renderLog("github-actions");
  try {
    d.resolve();
    await d.flush();
    const rows = () => d.frame().split("\n");
    const footerY = rows().findIndex(row => row.includes("n/N") || row.includes("c view"));
    const viewport = d.scrollbox().height;
    await d.key("/");
    await d.mockInput.typeText("-line");
    await d.flush();
    // Same dialog height: the footer stays put and the log gives up the bar and the empty row above it.
    expect(rows().findIndex(row => row.includes("c view"))).toBe(footerY);
    expect(d.scrollbox().height).toBe(viewport - 2);
    const barY = rows().findIndex(row => row.includes("/ -line"));
    expect(rows()[barY - 1].trim()).toBe("");
    expect(rows()[barY + 1].trim()).toBe("");
    // While typing, the slash, the input and the count share the input background.
    const element = RGBA.fromHex(d.theme.backgroundElement);
    expect(d.cell("/ -line")?.bg).toEqual(element);
    expect(d.cell("1/2")?.bg).toEqual(element);
    // The current hit's line number is inverted in the hit color; the other hit's number stays muted.
    const numberSpan = (label: string) =>
      d
        .captureSpans()
        .lines[rows().findIndex(row => row.includes(label))]?.spans.find(
          span => /^\s*\d+\s*$/.test(span.text) && span.text.trim() !== "",
        );
    expect(numberSpan("warning-line")?.text.trim()).toBe("2");
    expect(numberSpan("warning-line")?.bg).toEqual(RGBA.fromHex(d.theme.accent));
    expect(numberSpan("warning-line")?.fg).toEqual(RGBA.fromHex(d.theme.background));
    expect(numberSpan("error-line")?.fg).toEqual(RGBA.fromHex(d.theme.foregroundMuted));
    // Enter keeps the query: the bar loses the input background.
    await d.key("RETURN");
    expect(d.cell("1/2")?.bg).not.toEqual(element);
  } finally {
    await d.dispose();
  }
});

test("the log search tells the app while it owns Esc, so Esc clears it instead of closing the dialog", async () => {
  const d = await renderLog("github-actions");
  try {
    d.resolve();
    await d.flush();
    await d.key("/");
    expect(d.searchActive.mock.calls.at(-1)).toEqual([true]);
    await d.mockInput.typeText("line");
    await d.key("RETURN");
    expect(d.searchActive.mock.calls.at(-1)).toEqual([true]);
    await d.key("ESCAPE");
    expect(d.searchActive.mock.calls.at(-1)).toEqual([false]);
    expect(d.close).not.toHaveBeenCalled();
  } finally {
    await d.dispose();
  }
});

test("a kept search follows the text when the view changes, never pointing at a line that no longer matches", async () => {
  const d = await renderLog("github-actions");
  try {
    d.resolve();
    await d.flush();
    await d.key("/");
    await d.mockInput.typeText("-line");
    await d.key("RETURN");
    await d.key("n");
    expect(d.frame()).toContain("2/2");
    // Errors only: only error-line still matches; the position follows it.
    await d.key("c");
    await d.key("c");
    expect(d.frame()).toContain("1/1");
  } finally {
    await d.dispose();
  }
});

test("raw view shows the log as received, with timestamps", async () => {
  const fetchLog = async () => "2026-01-01T00:00:00.1234567Z first\n\n2026-01-01T00:00:01.0000000Z second";
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={createThemeState()}>
        <JobLogDialog
          provider="github-actions"
          job={{ id: 1, name: "job" }}
          jobs={[{ id: 1, name: "job" }]}
          run={{ name: "Build", runNumber: 1 }}
          fetchLog={fetchLog}
          onClose={() => {}}
        />
      </ThemeContext.Provider>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("2026-01-01T00:00:00.1234567Z");
    for (let i = 0; i < 3; i++) setup.mockInput.pressKey("c");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("2026-01-01T00:00:00.1234567Z first");
  } finally {
    await setup.dispose();
  }
});
