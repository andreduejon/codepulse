import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { useT } from "../../hooks/use-t";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

type HelpTab = "general" | "details" | "diff" | "commands";

const TABS: { id: HelpTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "details", label: "Details" },
  { id: "diff", label: "Diff" },
  { id: "commands", label: "Commands" },
];

const KEYBINDS: Record<HelpTab, [string, string][]> = {
  general: [
    ["↑/↓  or  j/k", "Navigate list"],
    ["shift  ↑/↓  or  shift  j/k", "Scroll 10 rows"],
    ["g", "Navigate to first commit"],
    ["G", "Navigate to last commit"],
    ["→  or  l", "Focus details panel"],
    ["space", "Toggle ancestry highlighting"],
    ["enter (mode)", "Confirm"],
    ["enter (compact)", "Open details dialog"],
    [":", "Switch to command mode"],
    ["/", "Switch to search mode"],
    ["shift  ←/→", "Switch mode"],
    ["esc", "Cancel, back (cascading)"],
  ],
  details: [
    ["←  or  h", "Previous tab, Exit details"],
    ["→  or  l", "Next tab"],
    ["↑/↓", "Navigate items"],
    ["shift  ↑/↓", "Scroll 10 items"],
    ["g", "Navigate to first item"],
    ["G", "Navigate to last item"],
    ["enter", "Activate item"],
  ],
  diff: [
    ["←  or  h", "Previous file"],
    ["→  or  l", "Next file"],
    ["↑/↓  or  j/k", "Navigate items"],
    ["shift  ↑/↓", "Scroll 10 items"],
    ["b", "Toggle blame"],
    ["c", "Cycle view: mixed/new/old"],
    ["w", "Toggle line wrap"],
    ["esc", "Close diff dialog"],
  ],
  commands: [
    [":q or :quit", "Quit the application"],
    [":m or :menu", "Open menu dialog"],
    [":f or :fetch", "Fetch from remote"],
    [":r or :reload", "Reload data from disk"],
    [":p or :path", "Switch to path mode"],
    [":search", "Switch to search mode"],
    [":a or :ancestry", "Toggle ancestry highlighting"],
    [":theme", "Open theme dialog"],
    [":help", "Open help dialog"],
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
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Help" />

        {/* Tab bar — paddingX={4} matches menu-dialog convention (outer=1, inner=4) */}
        <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
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
        {/* Muted separator below tabs */}
        <box width="100%" paddingX={4} flexShrink={0}>
          <box flexGrow={1} border={["top"]} borderStyle="single" borderColor={t().border} />
        </box>

        {/* Keybind list */}
        <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={KEYBINDS[activeTab()]}>
              {([key, desc]) => (
                <box flexDirection="row" width="100%" paddingX={4}>
                  <text flexShrink={0} wrapMode="none" fg={t().accent}>
                    <strong>{(key ?? "").padEnd(36)}</strong>
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
