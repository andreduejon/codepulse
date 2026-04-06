import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { SHIFT_JUMP } from "../../constants";
import { themeNames, themes, useTheme } from "../../context/theme";
import { KeyHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

/** Pre-computed theme options — themeNames and themes are module-level constants. */
const themeOptions = themeNames.map(key => ({
  key,
  name: themes[key].name,
}));

export default function ThemeDialog(props: Readonly<{ onClose: () => void }>) {
  const { theme, setTheme, themeName } = useTheme();
  const t = () => theme();
  const dimensions = useTerminalDimensions();
  const dialogWidth = () => 72;
  const dialogHeight = () => Math.min(themeOptions.length + 9, dimensions().height - 8);

  // Remember the original theme to revert on cancel
  const originalTheme = themeName();
  let confirmed = false;

  // Revert to original theme if dialog closes without confirmation
  onCleanup(() => {
    if (!confirmed) setTheme(originalTheme);
  });

  // Initialize cursor to the currently selected theme
  const initialIdx = themeOptions.findIndex(o => o.key === originalTheme);
  const [cursor, setCursor] = createSignal(initialIdx >= 0 ? initialIdx : 0);

  // Preview theme when cursor changes
  createEffect(() => {
    const opt = themeOptions[cursor()];
    if (opt) setTheme(opt.key);
  });

  const moveCursor = (delta: number) => {
    const len = themeOptions.length;
    setCursor(c => Math.max(0, Math.min(len - 1, c + delta)));
  };

  const confirmTheme = () => {
    confirmed = true;
    props.onClose();
  };

  useKeyboard(e => {
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
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Color Theme" />

        {/* Theme list — scrollable when terminal height is small */}
        <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
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
                    <text
                      flexShrink={0}
                      wrapMode="none"
                      fg={isSelected() ? themes[opt.key].accent : t().backgroundPanel}
                    >
                      {isSelected() ? "  █" : "   "}
                    </text>
                  </box>
                );
              }}
            </For>
          </box>
        </scrollbox>

        {/* Navigation footer */}
        <DialogFooter>
          <KeyHint key="enter" desc=" confirm  " />
          <KeyHint key="↑/↓" desc=" navigate" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
