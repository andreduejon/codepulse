/**
 * DetailDialog — wraps DetailPanel in a full-height overlay for compact mode.
 *
 * Shown when the terminal is too narrow for the normal two-column layout and
 * the user has focused the detail panel (e.g. via Enter or →).
 */

import { useTerminalDimensions } from "@opentui/solid";
import { Show } from "solid-js";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import DetailPanel, { type DetailPanelProps } from "../detail-panel";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import MessageBox, { type UIMessage } from "../message-box";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export function DetailDialog(
  props: Readonly<
    DetailPanelProps & {
      onClose: () => void;
      /** The banner over the graph is hidden behind this overlay, so its message (why a provider cannot work) shows here. */
      message?: UIMessage | null;
      onDismissMessage?: () => void;
    }
  >,
) {
  const dimensions = useTerminalDimensions();
  const t = useT();
  const { state } = useAppState();
  const dialogWidth = () => Math.min(72, dimensions().width - 8);
  const dialogHeight = () => dimensions().height - 8;

  // Dynamic enter verb based on what the cursored item does
  const enterVerb = () => state.detailCursorAction() ?? "select";

  return (
    <DialogOverlay>
      <box
        flexDirection="column"
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().background}
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Details" onClose={props.onClose} />
        <Show when={props.message}>
          {message => (
            <box flexDirection="column" width="100%" flexShrink={0}>
              <MessageBox
                kind={message().kind}
                source={message().source}
                title={message().title}
                message={message().message}
                detail={message().detail}
                variant="dialog"
                onDismiss={props.onDismissMessage}
                mouseEnabled
              />
              <box height={1} flexShrink={0} />
            </box>
          )}
        </Show>
        {/* paddingX=4 matches other dialogs' inner content padding (outer box already has paddingX=1) */}
        <box flexDirection="column" flexGrow={1} paddingX={4}>
          <DetailPanel {...props} mouseEnabled contentWidth={dialogWidth() - 10} />
        </box>
        <DialogFooter>
          <KeyHint
            key="enter"
            desc={` ${enterVerb()}`}
            disabled={props.navRef.itemCount === 0}
            onClick={() => props.navRef.activateCurrentItem?.()}
          />
          <KeyHintSeparator />
          <Show when={state.detailCursorShortcut()}>
            {shortcut => (
              <>
                <KeyHint key={shortcut().key} desc={` ${shortcut().desc}`} />
                <KeyHintSeparator />
              </>
            )}
          </Show>
          <KeyHint key="←/→" desc=" switch tab" />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc=" navigate" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
