import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { useT } from "../../hooks/use-t";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

type HelpTab = "general" | "detail" | "diff" | "commands";

const TABS: { id: HelpTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "detail", label: "Detail" },
  { id: "diff", label: "Diff" },
  { id: "commands", label: "Commands" },
];

const KEYBINDS: Record<HelpTab, [string, string][]> = {
  general: [
    ["↑/↓  or  j/k", "Navigate list (1 row)"],
    ["Shift+↑/↓  or  J/K", "Jump 10 rows"],
    ["g / G", "First / last commit"],
    ["→ / l", "Focus detail panel"],
    ["Enter (compact)", "Open detail dialog"],
    [":", "Open command bar"],
    ["/", "Search commits"],
    ["Shift+←/→", "Cycle command bar mode"],
    ["Esc", "Back / cancel (cascade)"],
  ],
  detail: [
    ["← / h", "Previous tab / exit detail"],
    ["→ / l", "Next tab"],
    ["↑/↓ (detail)", "Navigate items"],
    ["Shift+↑/↓", "Jump 10 rows"],
    ["g / G", "First / last item"],
    ["PgUp/PgDn", "Scroll half page"],
    ["Enter", "Activate item"],
  ],
  diff: [
    ["Enter (file)", "View diff"],
    ["← / →", "Previous / next file"],
    ["↑/↓  or  j/k", "Scroll 1 line"],
    ["Shift+↑/↓", "Scroll 10 lines"],
    ["PgUp/PgDn", "Scroll half page"],
    ["b", "Toggle blame"],
    ["c", "Cycle view: mixed/new/old"],
    ["w", "Toggle line wrap"],
    ["Esc", "Close diff"],
  ],
  commands: [
    [":q  /  :quit", "Quit the application"],
    [":m  /  :menu", "Open menu"],
    [":f  /  :fetch", "Fetch from remote"],
    [":r  /  :reload", "Reload data"],
    [":p  /  :path", "Filter by path"],
    [":search", "Open search"],
    [":theme", "Change theme"],
    [":help", "Show this help"],
  ],
};

export default function HelpDialog(_props: Readonly<{ onClose: () => void }>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(20, dimensions().height - 8);

  const [activeTab, setActiveTab] = createSignal<HelpTab>("general");

  const tabIndex = () => TABS.findIndex(t => t.id === activeTab());

  const prevTab = () => {
    const idx = tabIndex();
    if (idx > 0) setActiveTab(TABS[idx - 1].id);
  };

  const nextTab = () => {
    const idx = tabIndex();
    if (idx < TABS.length - 1) setActiveTab(TABS[idx + 1].id);
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "left" || e.name === "h") {
      e.preventDefault();
      prevTab();
    } else if (e.name === "right" || e.name === "l") {
      e.preventDefault();
      nextTab();
    }
  });

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={0}
        paddingY={1}
      >
        <DialogTitleBar title="Help" />

        {/* Tab bar — matches detail panel style exactly */}
        <box
          flexDirection="row"
          width="100%"
          flexShrink={0}
          border={["bottom"]}
          borderStyle="single"
          borderColor={t().border}
        >
          <For each={TABS}>
            {tab => {
              const isActive = () => activeTab() === tab.id;
              const lineColor = () => (isActive() ? t().accent : t().border);
              const textColor = () => (isActive() ? t().accent : t().foregroundMuted);
              return (
                <box
                  flexGrow={1}
                  justifyContent="center"
                  flexDirection="row"
                  border={["top"]}
                  borderStyle="single"
                  borderColor={lineColor()}
                >
                  <text flexShrink={0} wrapMode="none" fg={textColor()}>
                    <strong>{tab.label}</strong>
                  </text>
                </box>
              );
            }}
          </For>
        </box>

        {/* Keybind list */}
        <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={KEYBINDS[activeTab()]}>
              {([key, desc]) => (
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().accent}>
                    <strong>{(key ?? "").padEnd(20)}</strong>
                  </text>
                  <text flexGrow={1} wrapMode="none" fg={t().foreground}>
                    {desc}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>

        <DialogFooter>
          <KeyHint key="←/→" desc=" switch tab" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
