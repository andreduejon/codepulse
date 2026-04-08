import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { useT } from "../../hooks/use-t";
import { HELP_TABS, type HelpTab, KEYBINDS } from "../../keybinds";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(_props: Readonly<{ onClose: () => void }>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(20, dimensions().height - 8);

  const [activeTab, setActiveTab] = createSignal<HelpTab>("general");

  const tabIndex = () => HELP_TABS.findIndex(t => t.id === activeTab());

  const prevTab = () => {
    const idx = tabIndex();
    if (idx > 0) setActiveTab(HELP_TABS[idx - 1].id);
  };

  const nextTab = () => {
    const idx = tabIndex();
    if (idx < HELP_TABS.length - 1) setActiveTab(HELP_TABS[idx + 1].id);
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
          <For each={HELP_TABS}>
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
