import { createSignal, createEffect, For, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme, themeNames, themes } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { SHIFT_JUMP } from "../../constants";

/** Pre-computed theme options — themeNames and themes are module-level constants. */
const themeOptions = themeNames.map((key) => ({
  key,
  name: themes[key].name,
}));

export default function ThemeDialog(props: Readonly<{ onClose: () => void }>) {
  const { theme, setTheme, themeName } = useTheme();
  const t = () => theme();

  // Remember the original theme to revert on cancel
  const originalTheme = themeName();
  let confirmed = false;

  // Revert to original theme if dialog closes without confirmation
  onCleanup(() => {
    if (!confirmed) setTheme(originalTheme);
  });

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
        moveCursor(e.shift ? SHIFT_JUMP : 1);
        break;
      case "up":
        moveCursor(e.shift ? -SHIFT_JUMP : -1);
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
        height={themeOptions.length + 7}
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
                  <text flexGrow={1} wrapMode="none" fg={isSelected() ? t().accent : t().foreground}>
                      {opt.name}
                  </text>
                  <text flexShrink={0} wrapMode="none" fg={isSelected() ? themes[opt.key].accent : t().backgroundPanel}>
                    {isSelected() ? "  █" : "   "}
                  </text>
                </box>
              );
            }}
          </For>
        </box>

        {/* Navigation footer */}
        <box height={1} />
        <box flexDirection="row" width="100%" paddingX={4}>
          <box flexGrow={1} />
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>enter</text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" confirm  "}</text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>↑/↓</text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>{" navigate"}</text>
        </box>
      </box>
    </DialogOverlay>
  );
}
