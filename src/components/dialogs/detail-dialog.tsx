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
        backgroundColor={t().backgroundPanel}
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Details" />
        {/* paddingX=4 matches other dialogs' inner content padding (outer box already has paddingX=1) */}
        <box flexDirection="column" flexGrow={1} paddingX={4}>
          <DetailPanel
            scrollboxRef={props.scrollboxRef}
            navRef={props.navRef}
            searchFocused={props.searchFocused}
            onJumpToCommit={props.onJumpToCommit}
            onOpenDiff={props.onOpenDiff}
          />
        </box>
        <DialogFooter>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            enter
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` ${enterVerb()}  `}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"←/→"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" switch tab  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"↑/↓"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" navigate"}
          </text>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
