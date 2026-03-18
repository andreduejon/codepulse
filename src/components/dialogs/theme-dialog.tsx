import { createSignal, createEffect, For, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme, themeNames, themes } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

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
      case "down":
        moveCursor(1);
        break;
      case "up":
        moveCursor(-1);
        break;
      case "return":
        confirmTheme();
        break;
    }
  });

  return (
    <DialogOverlay>
      <box
        width={50}
        height={themeOptions.length + 5}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Color Theme" />

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
    </DialogOverlay>
  );
}
