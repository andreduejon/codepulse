import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { ComponentProps } from "solid-js";
import { type Accessor, Show } from "solid-js";
import type { DashboardEvent } from "../../core/dashboard/events";
import { providerDisplayName } from "../../core/provider-model";
import { useT } from "../../hooks/use-t";
import { DashboardDetail } from "../dashboard-detail";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";

/**
 * The selected dashboard event's details as a dialog, where the terminal is too narrow for the side panel: the same
 * frame as the graph's compact details.
 */
export function DashboardEventDialog(
  props: Readonly<{
    event: Accessor<DashboardEvent | null>;
    appName: (path: string) => string;
    onClose: () => void;
    onShowInGraph: () => void;
    onOpen: () => void;
    /** Whether `o` opens something: the event's page, or the tab row's own. */
    canOpen?: () => boolean;
    scrollboxRef?: (element: ScrollBoxRenderable) => void;
    /** The event's provider tab, as in the side panel: then Enter acts on its rows, `s` shows it in the graph. */
    tabProps?: Partial<ComponentProps<typeof DashboardDetail>>;
  }>,
) {
  const dimensions = useTerminalDimensions();
  const t = useT();
  const dialogWidth = () => Math.min(72, dimensions().width - 8);
  const dialogHeight = () => dimensions().height - 8;
  const hasTab = () => (props.tabProps?.tabs?.().length ?? 0) > 0;
  const showIn = () => providerDisplayName(props.event()?.source ?? "git");

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
          <DashboardDetail
            event={props.event}
            appName={props.appName}
            scrollboxRef={props.scrollboxRef}
            onShowInGraph={props.onShowInGraph}
            {...props.tabProps}
          />
        </box>
        <DialogFooter>
          <Show
            when={hasTab()}
            fallback={
              <KeyHint
                key="enter"
                desc=" show in graph"
                disabled={!props.event()}
                onClick={() => props.onShowInGraph()}
              />
            }
          >
            <KeyHint key="s" desc={` show in ${showIn()}`} onClick={() => props.onShowInGraph()} />
          </Show>
          <KeyHintSeparator />
          <Show when={props.canOpen ? props.canOpen() : props.event()?.url}>
            <KeyHint key="o" desc=" open" onClick={() => props.onOpen()} />
            <KeyHintSeparator />
          </Show>
          <KeyHint key="↑/↓" desc={hasTab() ? " navigate" : " scroll"} />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
