/**
 * DetailDialog — wraps DetailPanel in a full-height overlay for compact mode.
 *
 * Shown when the terminal is too narrow for the normal two-column layout and
 * the user has focused the detail panel (e.g. via Enter or →).
 */
import { useTerminalDimensions } from "@opentui/solid";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import DetailPanel, { type DetailPanelProps } from "../detail-panel";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export function DetailDialog(props: Readonly<DetailPanelProps & { onClose: () => void }>) {
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
          <KeyHint key="←/→" desc=" switch tab" />
          <KeyHintSeparator />
          <KeyHint key="↑/↓" desc=" navigate" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
