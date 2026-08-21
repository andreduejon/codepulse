import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import { getDialogTitleContentWidth, middleTruncate, TITLE_SEP } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import { useT } from "../../hooks/use-t";
import type { OpenShiftResource } from "./types";

interface OpenShiftResourceDialogProps {
  resource: OpenShiftResource;
  onClose: () => void;
}

const SCROLL_JUMP = 10;

export default function OpenShiftResourceDialog(props: Readonly<OpenShiftResourceDialogProps>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [wrapEnabled, setWrapEnabled] = createSignal(false);
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const dialogFrame = createMemo(() => getStandardDialogFrame(dimensions()));
  const lines = createMemo(() =>
    (JSON.stringify(props.resource.raw, null, 2) ?? String(props.resource.raw)).split("\n"),
  );
  const lineNoWidth = createMemo(() => lines().length.toString().length);
  const title = createMemo(() => {
    const fixed = ["OpenShift", props.resource.kind, props.resource.namespace].join(TITLE_SEP);
    const available = Math.max(8, getDialogTitleContentWidth(dialogFrame().width) - fixed.length - TITLE_SEP.length);
    return (
      <DialogTitle
        segments={[
          { text: "OpenShift" },
          { text: props.resource.kind },
          { text: props.resource.namespace },
          { text: middleTruncate(props.resource.name, available), emphasis: true },
        ]}
      />
    );
  });

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "q") {
      e.preventDefault();
      renderer.destroy();
    } else if (e.name === "escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.name === "up" || e.name === "k") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? -SCROLL_JUMP : -1, "absolute");
    } else if (e.name === "down" || e.name === "j") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? SCROLL_JUMP : 1, "absolute");
    } else if (e.name === "g") {
      e.preventDefault();
      scrollboxRef?.scrollTo(e.shift ? Infinity : 0);
    } else if (e.name === "w") {
      e.preventDefault();
      setWrapEnabled(value => !value);
    }
  });

  return (
    <DialogOverlay align="top" topOffset={2}>
      <box
        width={dialogFrame().width}
        height={dialogFrame().height}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={title()} />
        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" width="100%" paddingX={4}>
            <For each={lines()}>
              {(line, index) => (
                <box flexDirection="row" width="100%">
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {`${String(index() + 1).padStart(lineNoWidth())}  `}
                  </text>
                  <text wrapMode={wrapEnabled() ? "word" : "none"} fg={t().foreground}>
                    {line}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
        <DialogFooter>
          <KeyHint key="↑/↓" desc=" scroll" />
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " disable wrap" : " enable wrap"} />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
