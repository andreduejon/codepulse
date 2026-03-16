import { createSignal, createEffect, For, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme, themeNames, themes } from "../../context/theme";

export default function ThemeDialog(props: { onClose: () => void }) {
  const { theme, setTheme, themeName } = useTheme();
  const t = () => theme();

  // Remember the original theme to revert on cancel
  const originalTheme = themeName();
  let confirmed = false;

  // Revert to original theme if dialog closes without confirmation
  onCleanup(() => {
    if (!confirmed) setTheme(originalTheme);
  });

  const themeOptions = themeNames.map((key) => ({
    key,
    name: themes[key].name,
  }));

  // Initialize cursor to the currently selected theme
  const initialIdx = themeOptions.findIndex((o) => o.key === originalTheme);
  const [cursor, setCursor] = createSignal(initialIdx >= 0 ? initialIdx : 0);

  // Preview theme when cursor changes
  createEffect(() => {
    const opt = themeOptions[cursor()];
    if (opt) setTheme(opt.key);
  });

  const moveCursor = (delta: number) => {
    const len = themeOptions.length;
    setCursor((c) => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const confirmTheme = () => {
    confirmed = true;
    props.onClose();
  };

  useKeyboard((e) => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "j":
      case "down":
        moveCursor(1);
        break;
      case "k":
      case "up":
        moveCursor(-1);
        break;
      case "return":
        confirmTheme();
        break;
    }
  });

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={"#00000080"}
      alignItems="center"
      justifyContent="center"
      onMouseDown={() => props.onClose()}
    >
      <box
        width={50}
        height={themeOptions.length + 5}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        onMouseDown={(e: any) => { e.stopPropagation(); e.preventDefault(); }}
      >
        {/* Title bar */}
        <box flexDirection="row" width="100%" paddingX={4}>
          <text flexGrow={1} wrapMode="none">
            <strong><span fg={t().foreground}>Color Theme</span></strong>
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            <span fg={t().foregroundMuted}>{"esc".padStart(9)}</span>
          </text>
        </box>
        <box height={1} />

        {/* Theme list */}
        <box flexDirection="column" flexGrow={1}>
          <For each={themeOptions}>
            {(opt, optIndex) => {
              const isSelected = () => cursor() === optIndex();

              return (
                <box
                  flexDirection="row"
                  width="100%"
                  paddingX={4}
                  backgroundColor={isSelected() ? t().backgroundElement : undefined}
                  onMouseMove={() => setCursor(optIndex())}
                  onMouseDown={() => {
                    setCursor(optIndex());
                    confirmTheme();
                  }}
                >
                  <text flexGrow={1} wrapMode="none">
                    <span fg={isSelected() ? t().primary : t().foreground}>
                      {opt.name}
                    </span>
                  </text>
                  <text flexShrink={0} wrapMode="none" fg={isSelected() ? themes[opt.key].graphColors[0] : t().backgroundPanel}>
                    {isSelected() ? "  █" : "   "}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
      </box>
    </box>
  );
}
