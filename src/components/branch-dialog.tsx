import { createSignal, For, Show } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import type { Branch } from "../git/types";

export default function BranchDialog(props: {
  onClose: () => void;
  onSelect: (branch: string) => void;
}) {
  const { state } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();

  const localBranches = () =>
    state.branches().filter((b) => !b.isRemote);
  const remoteBranches = () =>
    state.branches().filter((b) => b.isRemote);

  const options = () =>
    localBranches().map((b) => ({
      name: b.name,
      description: b.isCurrent ? "current" : "",
    }));

  return (
    <box
      position="absolute"
      top="20%"
      left="25%"
      width="50%"
      height="60%"
      backgroundColor={t().backgroundPanel}
      border={true}
      borderColor={t().borderActive}
      borderStyle="rounded"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
    >
      <text wrapMode="none">
        <span fg={t().primary}>Switch Branch</span>
        <span fg={t().foregroundMuted}>
          {" "}
          ({localBranches().length} local, {remoteBranches().length} remote)
        </span>
      </text>
      <box height={1} />
      <select
        focused
        flexGrow={1}
        options={options()}
        backgroundColor={t().backgroundPanel}
        textColor={t().foreground}
        selectedBackgroundColor={t().backgroundElement}
        selectedTextColor={t().primary}
        focusedBackgroundColor={t().backgroundPanel}
        focusedTextColor={t().foreground}
        descriptionColor={t().foregroundMuted}
        selectedDescriptionColor={t().success}
        onSelect={(idx) => {
          const branch = localBranches()[idx];
          if (branch) {
            props.onSelect(branch.name);
            props.onClose();
          }
        }}
      />
      <box height={1} />
      <text wrapMode="none">
        <span fg={t().foregroundMuted}>Enter to select · Esc to cancel</span>
      </text>
    </box>
  );
}
