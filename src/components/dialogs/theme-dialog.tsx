import { MouseButton, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { SHIFT_JUMP } from "../../constants";
import { themes as predefinedThemes, type Theme, themeNames, useTheme } from "../../context/theme";
import { scrollIndexedItemIntoView } from "../../utils/scroll";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar, getStandardDialogFrame } from "./dialog-chrome";

const colorLabels: Record<Exclude<keyof Theme, "name" | "graphColors">, string> = {
  background: "Background",
  backgroundPanel: "Panel background",
  backgroundElement: "Element background",
  backgroundElementActive: "Active element",
  foreground: "Text",
  foregroundMuted: "Muted text",
  border: "Border",
  primary: "Primary",
  gitBg: "Git badge background",
  accent: "Accent",
  info: "Info",
  error: "Error",
  warning: "Warning",
  success: "Success",
  severityCritical: "Critical severity",
  severityHigh: "High severity",
  severityMedium: "Medium severity",
  severityLow: "Low severity",
  diffAdded: "Added text",
  diffRemoved: "Removed text",
  diffAddedBg: "Added background",
  diffRemovedBg: "Removed background",
  githubActionsFg: "GitHub Actions text",
  githubActionsBg: "GitHub Actions background",
  jenkinsFg: "Jenkins text",
  jenkinsBg: "Jenkins background",
  snykFg: "Snyk text",
  snykBg: "Snyk background",
  openShiftFg: "OpenShift text",
  openShiftBg: "OpenShift background",
};

export default function ThemeDialog(props: Readonly<{ onClose: () => void; onSelect?: (name: string) => void }>) {
  const renderer = useRenderer();
  const { theme, setTheme, themeName, themes, customThemes } = useTheme();
  const themeOptions = [
    ...themeNames.map(key => ({ key, name: themes[key].name })),
    ...customThemes.map(custom => ({
      key: custom.id,
      name: custom.theme.name,
    })),
  ];
  const customTheme = () => customThemes.find(custom => custom.id === themeName());
  const hasOverrides = () => customTheme()?.base !== undefined && (customTheme()?.overrides.length ?? 0) > 0;
  const baseLabel = () => {
    const base = customTheme()?.base;
    return base ? `${predefinedThemes[base].name} (${base})` : "none (standalone)";
  };
  const t = () => theme();
  const dimensions = useTerminalDimensions();
  const [showDetails, setShowDetails] = createSignal(false);
  const [hoveredTheme, setHoveredTheme] = createSignal<string | null>(null);
  const dialogWidth = () => Math.min(72, dimensions().width - 4);
  const dialogHeight = () => Math.min(32, getStandardDialogFrame(dimensions()).height);
  const palette = createMemo(() => {
    const custom = customTheme();
    const base = custom?.base ? predefinedThemes[custom.base] : undefined;
    return Object.entries(theme()).flatMap(([field, value]) => {
      if (field === "name") return [];
      const overridden = base !== undefined && custom?.overrides.includes(field as Exclude<keyof Theme, "name">);
      const baseValue = base?.[field as keyof Theme];
      return Array.isArray(value)
        ? value.map((hex, index) => ({
            label: `Graph color ${index + 1}`,
            hex,
            baseHex: overridden && Array.isArray(baseValue) ? (baseValue[index] ?? "—") : undefined,
          }))
        : [
            {
              label: colorLabels[field as keyof typeof colorLabels],
              hex: value,
              baseHex: overridden && typeof baseValue === "string" ? baseValue : undefined,
            },
          ];
    });
  });

  const originalTheme = themeName();
  const [savedTheme, setSavedTheme] = createSignal(originalTheme);

  // Discard only previews; selections already saved remain active on close.
  onCleanup(() => {
    setTheme(savedTheme());
  });

  // Initialize cursor to the currently selected theme
  const initialIdx = themeOptions.findIndex(o => o.key === originalTheme);
  const [cursor, setCursor] = createSignal(initialIdx >= 0 ? initialIdx : 0);
  let scrollboxRef: ScrollBoxRenderable | undefined;
  let detailsRef: ScrollBoxRenderable | undefined;
  const itemRefs: Renderable[] = [];

  // Preview theme when cursor changes
  createEffect(() => {
    const opt = themeOptions[cursor()];
    if (opt) setTheme(opt.key);
  });

  createEffect(() => {
    if (showDetails()) return;
    scrollIndexedItemIntoView(scrollboxRef, itemRefs, cursor());
  });

  const moveCursor = (delta: number) => {
    const len = themeOptions.length;
    setCursor(c => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const selectTheme = () => {
    props.onSelect?.(themeName());
    setSavedTheme(themeName());
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "q":
        e.preventDefault();
        renderer.destroy();
        break;
      case "escape":
        e.preventDefault();
        props.onClose();
        break;
      case "down":
        e.preventDefault();
        if (showDetails()) detailsRef?.scrollBy(e.shift ? SHIFT_JUMP : 1, "absolute");
        else moveCursor(e.shift ? SHIFT_JUMP : 1);
        break;
      case "up":
        e.preventDefault();
        if (showDetails()) detailsRef?.scrollBy(e.shift ? -SHIFT_JUMP : -1, "absolute");
        else moveCursor(e.shift ? -SHIFT_JUMP : -1);
        break;
      case "return":
        e.preventDefault();
        selectTheme();
        break;
      case "d":
        e.preventDefault();
        setShowDetails(value => !value);
        break;
      case "pageup":
      case "pagedown":
        if (showDetails() && detailsRef) {
          e.preventDefault();
          detailsRef.scrollBy((e.name === "pageup" ? -1 : 1) * detailsRef.viewport.height, "absolute");
        }
        break;
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
        <DialogTitleBar title="Color Theme" onClose={props.onClose} />

        <Show when={!showDetails()}>
          {/* Theme list — scrollable when terminal height is small */}
          <scrollbox
            ref={scrollboxRef}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            scrollY
            scrollX={false}
            verticalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column">
              <For each={themeOptions}>
                {(opt, optIndex) => {
                  const isPreviewed = () => cursor() === optIndex();
                  const isApplied = () => savedTheme() === opt.key;
                  const isHighlighted = () => isPreviewed() || hoveredTheme() === opt.key;

                  return (
                    <>
                      <Show when={optIndex() === 0 || optIndex() === themeNames.length}>
                        <Show when={optIndex() === themeNames.length}>
                          <box height={1} flexShrink={0} />
                        </Show>
                        <box width="100%" paddingX={4} flexShrink={0}>
                          <text wrapMode="none" fg={t().accent}>
                            <strong>{optIndex() === 0 ? "Predefined" : "Custom"}</strong>
                          </text>
                        </box>
                      </Show>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI themes support arrows and Enter. */}
                      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Arrows and Enter provide keyboard preview and selection. */}
                      <box
                        ref={(el: Renderable) => {
                          itemRefs[optIndex()] = el;
                        }}
                        flexDirection="row"
                        width="100%"
                        paddingX={4}
                        backgroundColor={isHighlighted() ? t().backgroundElement : undefined}
                        onMouseOver={() => setHoveredTheme(opt.key)}
                        onMouseOut={() => setHoveredTheme(null)}
                        onMouseDown={event => {
                          if (event.button !== MouseButton.LEFT) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setCursor(optIndex());
                          setTheme(opt.key);
                          selectTheme();
                        }}
                      >
                        <text
                          flexGrow={1}
                          flexShrink={1}
                          wrapMode="none"
                          truncate
                          fg={isHighlighted() ? t().accent : t().foreground}
                        >
                          {opt.name}
                        </text>
                        <text
                          flexShrink={0}
                          wrapMode="none"
                          fg={isHighlighted() || isApplied() ? themes[opt.key].accent : t().backgroundPanel}
                        >
                          {"  "}
                          <span
                            style={{
                              fg: isApplied() ? themes[opt.key].background : undefined,
                              bg: isApplied() ? themes[opt.key].accent : undefined,
                            }}
                          >
                            {isApplied() ? "✓" : isHighlighted() ? "█" : " "}
                          </span>
                        </text>
                      </box>
                    </>
                  );
                }}
              </For>
            </box>
          </scrollbox>
        </Show>

        <Show when={showDetails()}>
          <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} paddingX={4}>
            <box flexDirection="row" width="100%" flexShrink={0}>
              <box flexDirection="row" flexGrow={1} minWidth={0}>
                <text flexShrink={1} wrapMode="none" truncate fg={t().accent}>
                  <strong>{t().name}</strong>
                </text>
                <Show when={hasOverrides()}>
                  <text flexShrink={0} wrapMode="none" fg={t().accent}>
                    <strong>{" *"}</strong>
                  </text>
                </Show>
              </box>
              <text flexShrink={0} wrapMode="none" fg={themes[themeName()].accent}>
                {"  "}
                <span
                  style={{
                    fg: savedTheme() === themeName() ? themes[themeName()].background : undefined,
                    bg: savedTheme() === themeName() ? themes[themeName()].accent : undefined,
                  }}
                >
                  {savedTheme() === themeName() ? "✓" : "█"}
                </span>
              </text>
            </box>
            <box flexDirection="row" width="100%" flexShrink={0} paddingRight={2}>
              <text flexGrow={1} wrapMode="none" fg={t().foregroundMuted}>
                id
              </text>
              <text flexShrink={1} maxWidth="90%" wrapMode="word" selectable fg={t().foregroundMuted}>
                {themeName()}
              </text>
            </box>
            <Show when={customTheme()}>
              <box flexDirection="row" width="100%" flexShrink={0} paddingRight={2}>
                <text flexGrow={1} wrapMode="none" fg={t().foregroundMuted}>
                  base
                </text>
                <text flexShrink={0} wrapMode="none" selectable fg={t().foregroundMuted}>
                  {baseLabel()}
                </text>
              </box>
            </Show>
            <box height={1} flexShrink={0} />
            <scrollbox
              ref={detailsRef}
              flexGrow={1}
              flexShrink={1}
              minHeight={0}
              scrollY
              scrollX={false}
              verticalScrollbarOptions={{ visible: false }}
            >
              <box flexDirection="column">
                <For each={palette()}>
                  {entry => (
                    <box flexDirection="row" width="100%">
                      <text flexGrow={1} wrapMode="none" fg={t().foregroundMuted}>
                        {`${entry.label.toLowerCase()}${entry.baseHex !== undefined ? " *" : ""}`}
                      </text>
                      <text flexShrink={0} wrapMode="none" selectable fg={t().foregroundMuted}>
                        {`${entry.baseHex !== undefined ? `${entry.baseHex} → ` : ""}${entry.hex} `}
                        <span style={{ fg: entry.hex }}>█</span>
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </scrollbox>
          </box>
        </Show>

        {/* Navigation footer */}
        <DialogFooter>
          <KeyHint key="enter" desc=" select" onClick={selectTheme} />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc={showDetails() ? " scroll" : " navigate"} />
          <KeyHintSeparator />
          <KeyHint
            key="d"
            desc={showDetails() ? " themes" : " details"}
            onClick={() => setShowDetails(value => !value)}
          />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
