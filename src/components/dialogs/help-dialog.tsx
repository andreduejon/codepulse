import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { useT } from "../../hooks/use-t";
import { HELP_TABS, type HelpTab, KEYBINDS } from "../../keybinds";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function HelpDialog(_props: Readonly<{ onClose: () => void }>) {
  const t = useT();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 80;
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.7), dimensions().height - 8);
  const tabBarInnerWidth = () => dialogWidth() - 2 - 8;
  const tabWidth = (idx: number) => {
    const base = Math.floor(tabBarInnerWidth() / HELP_TABS.length);
    const remainder = tabBarInnerWidth() % HELP_TABS.length;
    return base + (idx < remainder ? 1 : 0);
  };

  const [activeTab, setActiveTab] = createSignal<HelpTab>("general");
  let scrollboxRef: ScrollBoxRenderable | undefined;

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
    } else if (e.name === "up" || e.name === "k") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? -5 : -1, "absolute");
    } else if (e.name === "down" || e.name === "j") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? 5 : 1, "absolute");
    } else if (e.name === "g") {
      e.preventDefault();
      scrollboxRef?.scrollTo(e.shift ? Infinity : 0);
    }
  });

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Help" />

        {/* Tab bar — paddingX={4} matches menu-dialog convention (outer=1, inner=4) */}
        <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
          <For each={HELP_TABS}>
            {(tab, idx) => {
              const isActive = () => activeTab() === tab.id;
              const lineColor = () => (isActive() ? t().accent : t().border);
              const textColor = () => (isActive() ? t().accent : t().foregroundMuted);
              return (
                <box
                  width={tabWidth(idx())}
                  flexShrink={0}
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
        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column">
            <For each={KEYBINDS[activeTab()]}>
              {row => {
                if (row.kind === "spacer") return <box height={1} />;
                if (row.kind === "section") {
                  return (
                    <box flexDirection="row" width="100%" paddingX={4}>
                      <text flexGrow={1} wrapMode="none" fg={t().foregroundMuted}>
                        <strong>{row.label}</strong>
                      </text>
                    </box>
                  );
                }
                return (
                  <box flexDirection="row" width="100%" paddingX={4} alignItems="flex-start">
                    <text flexShrink={0} width={28} wrapMode="none" fg={t().accent}>
                      <strong>{row.key}</strong>
                    </text>
                    <text flexGrow={1} wrapMode="word" fg={t().foreground}>
                      {row.desc}
                    </text>
                  </box>
                );
              }}
            </For>
          </box>
        </scrollbox>

        <DialogFooter>
          <KeyHint key="←/→" desc=" switch tab" />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc=" scroll" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
